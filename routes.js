const express = require("express");
const {
  User,
  Donor,
  BloodInventory,
  Request,
  Notification,
  BloodBank,
} = require("./models");
const {
  generateToken,
  hashPassword,
  comparePassword,
  protect,
  restrictTo,
  mockPredictions,
} = require("./utils");
const router = express.Router();

const sendResponse = (res, success, message, data = null, status = 200) => {
  return res.status(status).json({ success, message, data });
};

router.post("/auth/register", async (req, res) => {
  const {
    full_name,
    email,
    phone,
    password,
    role = "user",
    blood_type,
    region,
  } = req.body;
  try {
    if (!full_name || !email || !password || !blood_type) {
      return sendResponse(res, false, "Missing required fields", null, 400);
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return sendResponse(res, false, "User already exists", null, 409);
    }

    const password_hash = await hashPassword(password);

    const userData = {
      full_name,
      email,
      phone,
      password_hash,
      role,
      blood_type,
    };
    if (role !== "admin" && region) userData.region = region;

    const newUser = await User.create(userData);

    if (role === "donor") {
      await Donor.create({ user_id: newUser._id });
    }

    const token = generateToken({ id: newUser._id, role: newUser.role });
    sendResponse(
      res,
      true,
      "Registration successful",
      {
        token,
        user: {
          id: newUser._id,
          role: newUser.role,
          full_name: newUser.full_name,
          phone: newUser.phone,
          region: newUser.region,
        },
      },
      201
    );
  } catch (error) {
    sendResponse(res, false, error.message, null, 500);
  }
});

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await comparePassword(password, user.password_hash))) {
      return sendResponse(res, false, "Invalid credentials", null, 401);
    }

    const token = generateToken({ id: user._id, role: user.role });

    sendResponse(res, true, "Login successful", {
      token,
      user: {
        id: user._id,
        role: user.role,
        full_name: user.full_name,
        phone: user.phone,
        region: user.region || null,
      },
    });
  } catch (error) {
    sendResponse(res, false, error.message, null, 500);
  }
});

router.get(
  "/dashboard/user-stats",
  protect,
  restrictTo(["user"]),
  async (req, res) => {
    try {
      const bloodUnits = await BloodInventory.aggregate([
        { $group: { _id: null, total: { $sum: "$available_units" } } },
      ]);
      const donors = await Donor.countDocuments({ availability: true });
      const requests = await Request.countDocuments({
        requester_id: req.user.id,
      });
      sendResponse(res, true, "User dashboard stats", {
        bloodUnits: bloodUnits[0]?.total || 0,
        donors,
        requests,
      });
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.get(
  "/requests/user",
  protect,
  restrictTo(["user"]),
  async (req, res) => {
    try {
      const userRequests = await Request.find({ requester_id: req.user.id });
      sendResponse(res, true, "Fetched user requests", userRequests);
    } catch (err) {
      sendResponse(res, false, err.message, null, 500);
    }
  }
);

router.get("/predictions", protect, restrictTo(["admin"]), (req, res) => {
  sendResponse(res, true, "Mock Demand Prediction Data", mockPredictions);
});

router.get("/inventory/search", protect, async (req, res) => {
  const { type, region, availability } = req.query;
  const query = {};
  if (type) query.blood_type = type;

  try {
    let banks = await BloodBank.find();

    if (region) {
      const regex = new RegExp(region, "i");
      banks = banks.filter((bank) => regex.test(bank.location));
    }

    const inventory = await BloodInventory.find(query);
    const data = { banks, inventory };

    sendResponse(res, true, "Blood search results", data);
  } catch (error) {
    sendResponse(res, false, error.message, null, 500);
  }
});

router.post("/requests", protect, restrictTo(["user"]), async (req, res) => {
  const { blood_group, region, hospital, status,  notes } = req.body;

  if (!blood_group || !region) {
    return sendResponse(
      res,
      false,
      "Blood group and region are required",
      null,
      400
    );
  }

  try {
    const newRequest = await Request.create({
      requester_id: req.user.id,
      blood_group,
      region,
      status,
      hospital: hospital || "",
      notes: notes || "",
    });

    const donorUsers = await User.find({
      role: "donor",
      blood_type: blood_group,
      region,
    });

    const notifications = donorUsers.map((u) => ({
      title: "New Matching Request",
      message: `A new request for ${blood_group} has been posted in your region (${region}).`,
      role: "donor",
      region,
      type: "request",
      status: "unread",
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }

    sendResponse(res, true, "Blood request submitted", newRequest, 201);
  } catch (error) {
    console.error(error);
    sendResponse(res, false, error.message, null, 500);
  }
});

router.post("/requests/:id/status", protect, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ["Pending", "Approved", "Fulfilled", "Critical"];
  if (!status || !validStatuses.includes(status)) {
    return sendResponse(
      res,
      false,
      `Invalid status. Valid options: ${validStatuses.join(", ")}`,
      null,
      400
    );
  }

  try {
    const request = await Request.findById(id);
    if (!request) {
      return sendResponse(res, false, "Request not found", null, 404);
    }

    if (status === "Approved") {
      const approver = await User.findById(req.user.id);
      request.approved_by = {
        name: approver.full_name,
        phone: approver.phone,
      };
    }

    request.status = status;
    await request.save();

    sendResponse(res, true, "Request status updated successfully", request);
  } catch (error) {
    console.error(error);
    sendResponse(res, false, error.message, null, 500);
  }
});

router.get("/requests", protect, async (req, res) => {
  try {
    let requests;

    if (req.user.role === "admin") {
      requests = await Request.find()
        .populate("requester_id", "full_name blood_type phone region")
        .sort({ createdAt: -1 });
    } else if (req.user.role === "donor") {
      const donor = await User.findById(req.user.id);
      if (!donor.region)
        return sendResponse(res, false, "Donor region not set", null, 400);

      requests = await Request.find({ region: donor.region })
        .populate("requester_id", "full_name blood_type phone region")
        .sort({ createdAt: -1 });
    } else {
      requests = await Request.find({ requester_id: req.user.id })
        .populate("requester_id", "full_name blood_type phone region")
        .sort({ createdAt: -1 });
    }

    sendResponse(res, true, "Requests fetched successfully", requests);
  } catch (error) {
    sendResponse(res, false, error.message, null, 500);
  }
});

router.get(
  "/donors/search",
  protect,
  restrictTo(["admin", "user"]),
  async (req, res) => {
    try {
      const { blood_type, name, region } = req.query;

      const userQuery = { role: "donor" };
      if (blood_type) userQuery.blood_type = blood_type;
      if (region) userQuery.region = region;
      if (name) userQuery.full_name = { $regex: new RegExp(name, "i") };

      const users = await User.find(userQuery)
        .select("-password_hash -__v")
        .sort({ full_name: 1 });

      const donorsWithAvailability = await Promise.all(
        users.map(async (user) => {
          const donorData = await Donor.findOne({ user_id: user._id }).select(
            "availability"
          );

          return {
            ...user.toObject(),
            availability: donorData?.availability,
          };
        })
      );

      if (!donorsWithAvailability.length) {
        return sendResponse(
          res,
          true,
          "No donors found for given criteria",
          []
        );
      }

      sendResponse(res, true, "Donor search results", donorsWithAvailability);
    } catch (error) {
      console.error("Error while searching donors:", error);
      sendResponse(res, false, "Failed to fetch donors", null, 500);
    }
  }
);

router.get(
  "/donors/availability",
  protect,
  restrictTo(["donor"]),
  async (req, res) => {
    try {
      const donor = await Donor.findOne({ user_id: req.user.id }).select(
        "availability"
      );
      if (!donor) {
        return sendResponse(res, false, "Donor profile not found", null, 404);
      }

      sendResponse(res, true, "Availability fetched successfully", {
        availability: donor.availability,
      });
    } catch (error) {
      console.error(error);
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.post(
  "/donors/donate",
  protect,
  restrictTo(["donor"]),
  async (req, res) => {
    try {
      const { units = 1, notes = "" } = req.body;
      const donor = await Donor.findOne({ user_id: req.user.id });
      if (!donor)
        return sendResponse(res, false, "Donor profile not found", null, 404);

      const newDate = new Date();

      donor.donation_log = donor.donation_log || [];
      donor.donation_log.push({
        date: newDate,
        units,
        notes: notes || "Recorded via dashboard",
      });

      donor.last_donation_date = newDate;
      await donor.save();

      const user = await User.findById(req.user.id);
      let inventory = await BloodInventory.findOne({
        blood_type: user.blood_type,
      });
      if (!inventory) {
        inventory = await BloodInventory.create({
          blood_type: user.blood_type,
          available_units: units,
        });
      } else {
        inventory.available_units += units;
        await inventory.save();
      }

      sendResponse(res, true, "Donation recorded and inventory updated", {
        donor: {
          id: donor._id,
          last_donation_date: donor.last_donation_date,
          donation_log: donor.donation_log,
        },
        inventory: {
          blood_type: inventory.blood_type,
          available_units: inventory.available_units,
        },
      });
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.put(
  "/donors/availability",
  protect,
  restrictTo(["donor"]),
  async (req, res) => {
    let { availability } = req.body;

    availability = availability === true || availability === "true";

    try {
      const donor = await Donor.findOneAndUpdate(
        { user_id: req.user.id },
        { availability },
        { new: true }
      );

      if (!donor)
        return sendResponse(res, false, "Donor profile not found", null, 404);

      sendResponse(res, true, "Availability updated", {
        availability: donor.availability,
      });
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.get(
  "/donors/requests",
  protect,
  restrictTo(["donor"]),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      const pendingRequests = await Request.find({
        blood_group: user.blood_type,
        status: "Pending",
      });
      sendResponse(res, true, "Pending matching requests", pendingRequests);
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.get(
  "/donors/history",
  protect,
  restrictTo(["donor"]),
  async (req, res) => {
    try {
      const donor = await Donor.findOne({ user_id: req.user.id });
      if (!donor) return sendResponse(res, false, "Donor not found", null, 404);
      sendResponse(
        res,
        true,
        "Donation history fetched",
        donor.donation_log || []
      );
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.get("/notifications", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return sendResponse(res, false, "User not found", null, 404);

    let query;

    if (user.role === "admin") {
      query = {};
    } else if (user.role === "donor" && user.region) {
      query = {
        $or: [{ role: "all" }, { role: "donor", region: user.region }],
      };
    } else {
      query = {
        $or: [{ role: "all" }, { role: user.role, region: user.region }],
      };
    }

    const notifications = await Notification.find(query).sort({
      createdAt: -1,
    });
    sendResponse(res, true, "Dashboard notifications", notifications);
  } catch (error) {
    sendResponse(res, false, error.message, null, 500);
  }
});

router.put("/notifications/read/:id", protect, async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    sendResponse(res, true, "Notification marked as read");
  } catch (error) {
    sendResponse(res, false, error.message, null, 500);
  }
});

router.post(
  "/admin/notifications",
  protect,
  restrictTo(["admin"]),
  async (req, res) => {
    const { title, message, role = "all" } = req.body;
    try {
      const newNotification = await Notification.create({
        title,
        message,
        role,
      });
      sendResponse(res, true, "Notification created", newNotification, 201);
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.get("/admin/users", protect, restrictTo(["admin"]), async (req, res) => {
  const { page = 1, limit = 10, role } = req.query;
  const query = {};
  if (role) query.role = role;

  try {
    const users = await User.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select("-password_hash");
    const count = await User.countDocuments(query);

    sendResponse(res, true, "Users list", {
      users,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
    });
  } catch (error) {
    sendResponse(res, false, error.message, null, 500);
  }
});

router.put(
  "/admin/users/:id",
  protect,
  restrictTo(["admin"]),
  async (req, res) => {
    const { role } = req.body;
    try {
      const user = await User.findByIdAndUpdate(
        req.params.id,
        { role },
        { new: true }
      ).select("-password_hash");
      sendResponse(res, true, "User updated", user);
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.delete(
  "/admin/users/:id",
  protect,
  restrictTo(["admin"]),
  async (req, res) => {
    try {
      await User.findByIdAndDelete(req.params.id);
      await Donor.deleteOne({ user_id: req.params.id });
      sendResponse(res, true, "User deleted");
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.put(
  "/admin/donors/:id/verify",
  protect,
  restrictTo(["admin"]),
  async (req, res) => {
    try {
      const donor = await Donor.findOneAndUpdate(
        { user_id: req.params.id },
        { reputation: 10 },
        { new: true }
      );
      sendResponse(res, true, "Donor verified (reputation updated)", donor);
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.post(
  "/admin/banks",
  protect,
  restrictTo(["admin"]),
  async (req, res) => {
    const { name, location, contact } = req.body;
    try {
      const newBank = await BloodBank.create({ name, location, contact });
      sendResponse(res, true, "Blood bank added", newBank, 201);
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.get("/admin/banks", protect, restrictTo(["admin"]), async (req, res) => {
  try {
    const banks = await BloodBank.find();
    sendResponse(res, true, "All blood banks fetched", banks);
  } catch (error) {
    sendResponse(res, false, error.message, null, 500);
  }
});

router.put(
  "/admin/banks/:id/inventory",
  protect,
  restrictTo(["admin"]),
  async (req, res) => {
    const { available_units } = req.body;
    try {
      const bank = await BloodBank.findByIdAndUpdate(
        req.params.id,
        { available_units },
        { new: true }
      );
      sendResponse(res, true, "Blood bank inventory updated", bank);
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.put(
  "/admin/requests/:id/status",
  protect,
  restrictTo(["admin"]),
  async (req, res) => {
    const { status } = req.body;
    try {
      const request = await Request.findByIdAndUpdate(
        req.params.id,
        { status },
        { new: true }
      );
      sendResponse(res, true, "Request status updated", request);
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.put(
  "/admin/inventory/units",
  protect,
  restrictTo(["admin"]),
  async (req, res) => {
    const { blood_type, units } = req.body;
    try {
      let inventory = await BloodInventory.findOneAndUpdate(
        { blood_type },
        { available_units: units },
        { new: true, upsert: true }
      );
      sendResponse(res, true, "Inventory units updated", inventory);
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

router.get(
  "/admin/inventory/units",
  protect,
  restrictTo(["admin"]),
  async (req, res) => {
    try {
      const inventory = await BloodInventory.find();
      sendResponse(res, true, "Inventory data", inventory);
    } catch (error) {
      sendResponse(res, false, error.message, null, 500);
    }
  }
);

module.exports = router;

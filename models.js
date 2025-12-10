const mongoose = require('mongoose');

// Iss file ko prettier yaa beautify se format mt kerna

const UserSchema = new mongoose.Schema({
    full_name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    password_hash: { type: String, required: true },
    role: { type: String, enum: ['user', 'donor', 'admin'], default: 'user' },
    blood_type: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'], required: true },
    region: { type: String, enum: ['North', 'East', 'West', 'South'], required: function() { return this.role !== 'admin'; } },
});


const DonorSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  availability: { type: Boolean, default: true },
  last_donation_date: { type: Date, default: null },
  reputation: { type: Number, default: 5 },

  donation_log: [
    {
      date: { type: Date, required: true },
      units: { type: Number, default: 1 },
      notes: { type: String },
    },
  ],
});


const BloodInventorySchema = new mongoose.Schema({
    blood_type: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'], required: true, unique: true },
    available_units: { type: Number, default: 0 },
    status: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium' },
});

const RequestSchema = new mongoose.Schema(
  {
    requester_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    blood_group: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'], required: true },
    region: { type: String, required: true },
    hospital: { type: String },
    notes: { type: String },
    status: { type: String, enum: ['Pending', 'Approved', 'Fulfilled', 'Critical'], default: 'Pending' },
    approved_by: {
      name: { type: String },
      phone: { type: String },
    },
  },
  { timestamps: true }
);


const NotificationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  role: { type: String, enum: ['user', 'donor', 'admin', 'all'], default: 'all', required: true },
  region: { type: String, enum: ['North', 'East', 'West', 'South'], default: null }, // optional region
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});


const BloodBankSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    location: { type: String, required: true },
    contact: { type: String },
    available_units: { type: Map, of: Number, default: {} },
});

const User = mongoose.model('User', UserSchema);
const Donor = mongoose.model('Donor', DonorSchema);
const BloodInventory = mongoose.model('BloodInventory', BloodInventorySchema);
const Request = mongoose.model('Request', RequestSchema);
const Notification = mongoose.model('Notification', NotificationSchema);
const BloodBank = mongoose.model('BloodBank', BloodBankSchema);

module.exports = { User, Donor, BloodInventory, Request, Notification, BloodBank };
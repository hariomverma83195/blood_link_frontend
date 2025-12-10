const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { User } = require('./models');

const SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 10;

const generateToken = (payload) => {
    return jwt.sign(payload, SECRET, { expiresIn: '1d' });
};

const hashPassword = async (password) => {
    return bcrypt.hash(password, SALT_ROUNDS);
};

const comparePassword = async (password, hash) => {
    return bcrypt.compare(password, hash);
};

const protect = (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }

    try {
        const decoded = jwt.verify(token, SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
    }
};

const restrictTo = (roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Forbidden: You do not have permission' });
    }
    next();
};

const seedAdmin = async () => {
    try {
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPass = process.env.ADMIN_PASS;
        const adminName = process.env.ADMIN_NAME;
        const existingAdmin = await User.findOne({ email: adminEmail });

        if (!existingAdmin) {
            const hashedPassword = await hashPassword(adminPass);
            await User.create({
                full_name: adminName,
                email: adminEmail,
                phone: '0000000000',
                password_hash: hashedPassword,
                role: 'admin',
                blood_type: 'O+',
            });
            console.log('Admin user seeded successfully');
        } else {
            console.log('Admin user already exists');
        }
    } catch (error) {
        console.error('Error seeding admin:', error.message);
    }
};

const mockPredictions = {
    "A+": 72, "A-": 55, "B+": 64, "B-": 40,
    "O+": 78, "O-": 32, "AB+": 59, "AB-": 44
};

module.exports = {
    generateToken, hashPassword, comparePassword,
    protect, restrictTo, seedAdmin, mockPredictions
};
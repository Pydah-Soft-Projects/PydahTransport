const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadDir = path.join(__dirname, '../public/uploads/bills');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const safeName = String(file.originalname || 'bill')
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .slice(0, 80);
        cb(null, `${Date.now()}-${safeName}`);
    }
});

const fileFilter = (_req, file, cb) => {
    const allowed = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'image/gif',
        'application/pdf'
    ];
    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only image or PDF files are allowed for bill attachments'));
    }
};

const uploadBillAttachments = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024, files: 8 }
}).array('attachments', 8);

module.exports = {
    uploadDir,
    uploadBillAttachments
};

// server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const Razorpay = require('razorpay');
const Replicate = require('replicate');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// Initialize Replicate + Razorpay
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Simple in-memory user credits (replace with DB in real use)
let userCredits = {}; // { userId: number }

// Create Razorpay order
app.post('/api/pay', async (req, res) => {
  const userId = req.headers['user-id'] || 'default';
  try {
    const options = {
      amount: 100, // 1 INR = 100 paisa
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      notes: { userId },
    };

    const order = await razorpay.orders.create(options);
    res.json({ orderId: order.id, amount: options.amount, currency: options.currency });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creating Razorpay order' });
  }
});

// Verify payment and add credits
app.post('/api/verify', (req, res) => {
  const { orderId, paymentId, signature, userId } = req.body;

  const generatedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(orderId + "|" + paymentId)
    .digest('hex');

  if (generatedSignature === signature) {
    userCredits[userId] = (userCredits[userId] || 0) + 7; // add 7 credits
    res.json({ success: true, credits: userCredits[userId] });
  } else {
    res.status(400).json({ success: false, message: "Invalid payment signature" });
  }
});

// Generate image using Replicate
app.post('/api/generate', upload.single('image'), async (req, res) => {
  const { style } = req.body || {};
  const userId = req.headers['user-id'] || 'default';

  if (!userCredits[userId] || userCredits[userId] <= 0) {
    return res.status(403).json({ error: 'No credits left' });
  }

  try {
    // Read uploaded file and convert to base64
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const imageData = fs.readFileSync(req.file.path, { encoding: 'base64' });
    const base64Image = `data:image/png;base64,${imageData}`;

    // Use your Replicate model here (change model if needed)
    const output = await replicate.run(
      "stability-ai/sdxl:8d24e0e8f7b90e2a6a061b8f849f142fcbf1f73f83f44f83b6ee6a1fdaea9f7c",
      {
        input: {
          prompt: `in ${style || 'default'} style`,
          image: base64Image,
        },
      }
    );

    // Deduct credit
    userCredits[userId]--;

    // Cleanup temp file
    fs.unlink(req.file.path, () => {});

    res.json({ url: Array.isArray(output) ? output[0] : output, creditsLeft: userCredits[userId] });
  } catch (err) {
    console.error(err);
    // try to cleanup
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Error generating image', details: err.message });
  }
});

// Check credits
app.get('/api/credits', (req, res) => {
  const userId = req.headers['user-id'] || 'default';
  res.json({ credits: userCredits[userId] || 0 });
});

app.listen(process.env.PORT || 5000, () => console.log('✅ Server running'));
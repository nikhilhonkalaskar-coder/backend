import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());

// ==============================
// In-memory OTP Store
// ==============================
const OTP_STORE = {};
// format => { phone: { otp, expires } }

// ==============================
// SEND OTP
// ==============================
app.post("/api/send-otp", async (req, res) => {
  const { phone } = req.body;

  // Validate Indian mobile number
  if (!/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({
      success: false,
      message: "Invalid mobile number"
    });
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 5 * 60 * 1000; // 5 minutes

  OTP_STORE[phone] = { otp, expires };

  console.log("Generated OTP:", otp);

  try {
    await axios.post(
      "https://api.interakt.ai/v1/public/message/",
      {
        countryCode: "91",
        phoneNumber: phone,
        type: "Template",
        template: {
          name: "otp_verification",      // MUST MATCH TEMPLATE NAME
          languageCode: "en",
          bodyValues: [otp],
          buttonValues: {
            "0": [otp]                  // 👈 REQUIRED FORMAT
          }
        }
      },
      {
        headers: {
          Authorization: `Basic ${process.env.INTERAKT_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      success: true,
      message: "OTP sent successfully"
    });

  } catch (err) {
    console.error("Interakt error:", err.response?.data || err.message);

    res.status(500).json({
      success: false,
      message: "Failed to send OTP",
      error: err.response?.data
    });
  }
});

// ==============================
// VERIFY OTP
// ==============================
app.post("/api/verify-otp", (req, res) => {
  const { phone, otp, name, email, city } = req.body;

  const record = OTP_STORE[phone];

  if (!record) {
    return res.json({ verified: false, message: "OTP not found" });
  }

  if (Date.now() > record.expires) {
    delete OTP_STORE[phone];
    return res.json({ verified: false, message: "OTP expired" });
  }

  if (record.otp !== otp) {
    return res.json({ verified: false, message: "Wrong OTP" });
  }

  delete OTP_STORE[phone];

  // 👇 WhatsApp pre-filled message
  const message = `
*Tushar Bhumkar Institute*

*Verified Lead*
Name: ${name}
Mobile: ${phone}
Email: ${email || "N/A"}
City: ${city || "N/A"}
`;

  const redirectUrl =
    `https://wa.me/${process.env.WHATSAPP_CHAT_NUMBER}?text=` +
    encodeURIComponent(message);

  res.json({
    verified: true,
    redirectUrl
  });
});


// ==============================
// START SERVER
// ==============================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});



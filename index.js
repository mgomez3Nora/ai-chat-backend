import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import admin from "firebase-admin";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

// --- Firebase setup ---
const serviceAccount = JSON.parse(fs.readFileSync("/etc/secrets/firebase-key.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// --- In-memory session store ---
let activeSessions = {};

// --- Chat endpoint ---
app.post("/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    // Call OpenAI
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a helpful, warm AI support agent." },
          { role: "user", content: message }
        ]
      })
    });

    const data = await response.json();
    const aiReply = data.choices[0].message.content;

    // Initialize session transcript if it doesn’t exist
    if (!activeSessions[sessionId]) {
      activeSessions[sessionId] = [];
    }

    // Store this conversation turn
    activeSessions[sessionId].push({ user: message, ai: aiReply });

    // Send reply back to frontend
    res.json({ reply: aiReply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// --- End chat and save transcript ---
app.post("/end-chat", async (req, res) => {
  try {
    const { sessionId } = req.body;
    const transcript = activeSessions[sessionId] || [];

    // Save to Firestore
    await db.collection("chatTranscripts").add({
      sessionId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      transcript
    });

    // Clear session from memory
    delete activeSessions[sessionId];

    res.json({ message: "Transcript saved successfully." });
  } catch (err) {
    console.error("End chat error:", err);
    res.status(500).json({ error: "Could not save transcript." });
  }
});

// --- Server start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

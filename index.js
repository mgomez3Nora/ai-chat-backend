import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import admin from "firebase-admin";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Load Firebase service account JSON from secrets file
let serviceAccount = null;
try {
  const keyPath = "/etc/secrets/firebase-key.json";
  serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
} catch (err) {
  console.error("❌ Failed to load Firebase service account:", err);
}

if (!admin.apps.length && serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

// Track sessions
const sessions = {};

// -------------------- CHAT ENDPOINT --------------------
app.post("/chat", async (req, res) => {
  const { message, sessionId } = req.body;

  // Initialize session with fixed dummy data
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      count: 0,
      transcript: [],
      dummyData: {
        customerName: "Alex Johnson",
        product: "Smart Fitness Watch",
        trackingNumber: "739182645",
        finalLocation: "Springfield, IL"
      }
    };
  }

  sessions[sessionId].count++;
  const turn = sessions[sessionId].count;
  const { customerName, product, trackingNumber, finalLocation } = sessions[sessionId].dummyData;

  // Persona prompt with dummy data hidden until revealed
  let systemPrompt = `
You are roleplaying as a frustrating customer service representative at a shipping company. 
The customer is contacting you about their package.

IMPORTANT:
- You secretly know the following customer info but must NOT reveal it until the user provides it:
  - Name: ${customerName}
  - Product: ${product}
  - Tracking Number: ${trackingNumber}
  - Final Location: ${finalLocation}

Rules:
- Always ask the customer for their name, product, and tracking number as if you don’t already know them.
- Never greet them by name until they give it to you.
- If the customer gives partial info, ask again for the missing pieces.
- Frequently repeat requests or pretend there’s confusion about the product or tracking number.
- Sometimes ask for unnecessary details like address.
- Keep responses 2–5 sentences, like a real CSR chat.
- Do NOT reveal the package location until AFTER 10 turns.
- On turn 11+, finally reveal: "Your package is currently in ${finalLocation}."

Behavior by turns:
- Turns 1–2: Ask for obvious info (name, product, tracking number).
- Turns 3–4: Ask again, over-apologize, claim you didn’t catch it, or that the system needs confirmation.
- Turns 5–6: Stall harder ("system is running slow", "please allow 24 hours").
- Turns 7–10: Maximally frustrating: repeat apologies, deflect responsibility, escalate, send them in circles.
- Turn 11+: Reveal the city/state of the package.
`;

  try {
    const conversation = [
      { role: "system", content: systemPrompt },
      ...sessions[sessionId].transcript.flatMap((t) => [
        { role: "user", content: t.user },
        { role: "assistant", content: t.ai }
      ]),
      { role: "user", content: message }
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: conversation,
        temperature: 0.85,
        max_tokens: 200
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI API Error:", data);
      return res.status(500).json({ reply: "Sorry, the AI had an issue responding." });
    }

    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I’m having trouble responding.";

    sessions[sessionId].transcript.push({ user: message, ai: reply });

    res.json({ reply, dummyData: sessions[sessionId].dummyData }); 
  } catch (error) {
    console.error("Error in /chat:", error);
    res.status(500).json({ reply: "Sorry, something went wrong." });
  }
});

// -------------------- END CHAT ENDPOINT --------------------
app.post("/end-chat", async (req, res) => {
  const { sessionId } = req.body;
  const transcript = sessions[sessionId]?.transcript || [];

  try {
    await db.collection("chatTranscripts").doc(sessionId).set({
      transcript,
      dummyData: sessions[sessionId]?.dummyData || {},
      endedAt: new Date().toISOString()
    });
    delete sessions[sessionId];
    res.json({ message: "Chat ended. Transcript saved." });
  } catch (error) {
    console.error("Error saving transcript:", error);
    res.status(500).json({ message: "Failed to save transcript." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

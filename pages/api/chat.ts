import { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import { Readable } from "stream";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const VOICE_INSTRUCTIONS = `You are a warm, empathetic voice assistant for an endometriosis support application. Your tone should be:
- Warm and supportive
- Clear and gentle
- Professional yet approachable
- Paced appropriately for medical information
- Emotionally attuned to the sensitive nature of the topic

When speaking:
- Use a natural, conversational pace
- Emphasize key medical terms clearly
- Maintain a calm, reassuring tone
- Break complex information into digestible parts
- Show empathy while maintaining professionalism`;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { conversation, fileSearchInstruction, previous_response_id } = req.body;

    // Get the last user message
    const lastUserMessage = conversation
      .slice()
      .reverse()
      .find((msg: any) => msg.role === "user");

    if (!lastUserMessage) {
      return res.status(400).json({ error: "No user message found" });
    }

    // Set up streaming response
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");

    // Create the audio stream
    console.log("Creating audio stream...");
    const audioResponse = await openai.audio.speech.create({
      model: "tts-1",
      voice: "nova",
      input: lastUserMessage.content,
      response_format: "mp3",
    });

    if (!audioResponse.body) {
      throw new Error("No audio stream received");
    }

    console.log("Audio response received:", audioResponse);
    console.log("Setting up stream handling...");

    // Pipe the audio stream directly to the response
    const stream = audioResponse.body as unknown as Readable;
    stream.pipe(res);

    stream.on("end", () => {
      console.log("Stream reading complete");
    });

    stream.on("error", (error) => {
      console.error("Stream error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error streaming audio" });
      }
    });

  } catch (error) {
    console.error("Error in chat endpoint:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

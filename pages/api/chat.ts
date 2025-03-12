import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import DEFAULT_INSTRUCTION from "../../config/instruction";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Data = {
  reply?: string;
  audio?: string; // base64 encoded audio (mp3)
  previous_response_id?: string;
  error?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Expect conversation, fileSearchInstruction, and optionally previous_response_id from the client.
  const { conversation, fileSearchInstruction, previous_response_id } = req.body;
  
  if (!conversation || !Array.isArray(conversation)) {
    return res.status(400).json({ error: "Invalid conversation history" });
  }

  try {
    // Determine the input.
    // If previous_response_id is provided, only send the latest user message.
    // Otherwise, just use the latest message as the input.
    let inputStr: string;
    if (previous_response_id) {
      inputStr = conversation[conversation.length - 1].content;
    } else {
      // For a new conversation, still only send the latest user message.
      // Context will be maintained via the instruction.
      inputStr = conversation[conversation.length - 1].content;
    }

    // Merge the default instruction with any supplemental fileSearchInstruction from the client.
    const instructionText = fileSearchInstruction
      ? `${DEFAULT_INSTRUCTION} ${fileSearchInstruction}`.trim()
      : DEFAULT_INSTRUCTION;

    // Build the payload for the Responses API.
    const responsesPayload: any = {
      model: "gpt-4o-mini",
      instructions: instructionText,
      input: inputStr,
      temperature: 0.7,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [process.env.VECTOR_STORE_ID]
        }
      ]
    };

    // Include previous_response_id if present.
    if (previous_response_id) {
      responsesPayload.previous_response_id = previous_response_id;
    }

    console.log("Responses Payload:", responsesPayload);

    // Call the Responses API.
    const responsesRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(responsesPayload)
    });

    const responsesData = await responsesRes.json();
    console.log("Responses Data:", responsesData);

    if (responsesData.error) {
      return res
        .status(500)
        .json({ error: responsesData.error.message || "OpenAI API error in responses" });
    }

    // Extract the reply from responsesData.output by selecting the message with type "message".
    let reply: string | undefined;
    const messageItem = responsesData.output?.find((item: any) => item.type === "message");
    if (messageItem) {
      if (Array.isArray(messageItem.content)) {
        reply = messageItem.content
          .map((part: any) => {
            if (typeof part === "string") {
              return part;
            } else if (typeof part === "object" && part.text) {
              return part.text;
            } else {
              return JSON.stringify(part);
            }
          })
          .join(" ");
      } else {
        reply = messageItem.content;
      }
    }
    if (!reply) {
      return res.status(500).json({ error: "No reply returned from responses API" });
    }

    // Convert the text reply into audio using the TTS API.
    const audioResponse = await openai.audio.speech.create({
      model: "tts-1",
      voice: "coral",
      input: reply
    });

    const arrayBuffer = await audioResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Audio = buffer.toString("base64");

    // Return the reply, audio, and the new previous_response_id (the API response id) for conversation chaining.
    return res.status(200).json({
      reply,
      audio: base64Audio,
      previous_response_id: responsesData.id
    });
  } catch (error: any) {
    console.error("Error in API:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

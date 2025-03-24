import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import DEFAULT_INSTRUCTION from "../../config/instruction";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Data = {
  reply?: string;
  audio?: string; // base64 encoded audio (mp3)
  previous_response_id?: string;
  error?: string;
  retryAfter?: number;
  shouldRetry?: boolean;
};

interface ResponsesPayload {
  model: string;
  instructions: string;
  input: string;
  temperature: number;
  tools: Array<{
    type: string;
    vector_store_ids: string[];
  }>;
  previous_response_id?: string;
}

interface MessageContent {
  type: string;
  content: string | Array<{
    text?: string;
    [key: string]: unknown;
  }>;
}

interface ResponsesData {
  id?: string;
  output?: MessageContent[];
  error?: {
    code: string;
    message: string;
  };
}

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
    const responsesPayload: ResponsesPayload = {
      model: "gpt-4o-mini",
      instructions: instructionText,
      input: inputStr,
      temperature: 0.7,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [process.env.VECTOR_STORE_ID || '']
        }
      ]
    };

    // Include previous_response_id if present.
    if (previous_response_id) {
      responsesPayload.previous_response_id = previous_response_id;
    }

    console.log("Responses Payload:", responsesPayload);

    // Function to extract retry time from error message
    const getRetryAfterSeconds = (message: string): number => {
      const match = message.match(/try again in (\d+\.?\d*)s/);
      return match ? parseFloat(match[1]) : 5; // default to 5 seconds if no time found
    };

    // Function to make the API call with retry logic
    const callResponsesAPI = async (): Promise<ResponsesData> => {
      const responsesRes = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify(responsesPayload)
      });

      const responsesData = await responsesRes.json() as ResponsesData;
      console.log("Responses API Status:", responsesRes.status);
      console.log("Responses Data:", JSON.stringify(responsesData, null, 2));

      // Check for rate limit error
      if (responsesData.error?.code === 'rate_limit_exceeded') {
        const retryAfter = getRetryAfterSeconds(responsesData.error.message);
        console.log(`Rate limit hit. Retrying in ${retryAfter} seconds...`);
        
        // Return a special response to inform the client about the retry
        return {
          error: {
            code: 'rate_limit_exceeded',
            message: `Rate limit reached. Retrying automatically...`
          }
        };
      }

      if (!responsesRes.ok) {
        console.error("OpenAI API Error:", responsesData);
        throw new Error(responsesData.error?.message || `OpenAI API error: ${responsesRes.status}`);
      }

      return responsesData;
    };

    // Make the initial API call with retry logic
    const responsesData = await callResponsesAPI();
    
    // If we got a retry response, return early
    if (responsesData.error?.code === 'rate_limit_exceeded') {
      return res.status(429).json({ 
        error: responsesData.error.message,
        retryAfter: 5,
        shouldRetry: true
      });
    }

    if (responsesData.error) {
      console.error("OpenAI Response Error:", responsesData.error);
      return res
        .status(500)
        .json({ error: responsesData.error.message || "OpenAI API error in responses" });
    }

    // Extract the reply from responsesData.output by selecting the message with type "message".
    let reply: string | undefined;
    const messageItem = responsesData.output?.find((item: MessageContent) => item.type === "message");
    if (messageItem) {
      if (Array.isArray(messageItem.content)) {
        reply = messageItem.content
          .map((part) => {
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
        reply = messageItem.content as string;
      }
    }
    if (!reply) {
      return res.status(500).json({ error: "No reply returned from responses API" });
    }

    // Convert the text reply into audio using the TTS API.
    const audioResponse = await openai.audio.speech.create({
      model: "tts-1",
      voice: "nova", // Nova is optimized for faster responses
      input: reply,
      response_format: "mp3",
      speed: 1.0
    });

    // Handle the audio data
    const arrayBuffer = await audioResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Audio = buffer.toString("base64");

    // Return the reply, audio, and the new previous_response_id
    return res.status(200).json({
      reply,
      audio: base64Audio,
      previous_response_id: responsesData.id
    });
  } catch (error: unknown) {
    console.error("Error in API:", error);
    console.error("Error details:", {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    return res.status(500).json({ error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}` });
  }
}

import { NextApiRequest, NextApiResponse } from "next";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import OpenAI from "openai";
import instructionStandard from "../../config/instructionStandard";
import instructionAdvanced from "../../config/instructionAdvanced";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ConversationRequest {
  conversation: ConversationMessage[];
  previous_response_id?: string;
}

interface ResponsesPayload {
  model: string;
  instructions: string;
  input: string;
  temperature: number;
  tools: Array<{
    type: string;
    vector_store_ids: string[];
    max_num_results?: number;
  }>;
  previous_response_id?: string;
}

interface ResponseOutputItem {
  type: string;
  content: string | Array<string | { text: string }>;
}

interface ResponseData {
  id?: string;
  output?: ResponseOutputItem[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { conversation, previous_response_id, answerType } = req.body;
    
    if (!conversation || !Array.isArray(conversation)) {
      return res.status(400).json({ error: "Invalid conversation format" });
    }

    // Get the last user message
    const lastUserMessage = conversation
      .slice()
      .reverse()
      .find((msg) => msg.role === "user");
    
    if (!lastUserMessage) {
      return res.status(400).json({ error: "No user message found" });
    }

    // Select instruction based on answerType
    const instruction = answerType === 'Advanced' ? instructionAdvanced : instructionStandard;

    // Prepare the payload for the Responses API
    const responsesPayload: ResponsesPayload = {
      model: "gpt-4o-mini",
      instructions: instruction,
      input: lastUserMessage.content,
      temperature: 0.7,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [process.env.VECTOR_STORE_ID || ''],
          max_num_results: 20
        }
      ]
    };

    if (previous_response_id) {
      responsesPayload.previous_response_id = previous_response_id;
    }

    console.log("Sending payload to Responses API:", JSON.stringify(responsesPayload, null, 2));

    // Set up streaming response
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    // Create a controller for the fetch request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000);

    try {
      // Make the request to the Responses API
      const responsesRes = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify(responsesPayload),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!responsesRes.ok) {
        const errorText = await responsesRes.text();
        console.error("OpenAI API error response:", errorText);
        return res.status(responsesRes.status).json({ 
          error: `OpenAI API error: ${responsesRes.status}`,
          details: errorText
        });
      }
      
      const responsesData = await responsesRes.json() as ResponseData;
      console.log("Received response data:", responsesData);
      
      // Extract the reply from responsesData.output
      let reply: string | undefined;
      const messageItem = responsesData.output?.find((item: ResponseOutputItem) => item.type === "message");
      if (messageItem) {
        if (Array.isArray(messageItem.content)) {
          reply = messageItem.content
            .map((part: string | { text: string }) => {
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
        return res.status(500).json({ error: "No reply generated from OpenAI" });
      }
      
      console.log("Generated reply:", reply);
      
      // Generate audio from the reply
      const audioResponse = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "tts-1",
          voice: "alloy",
          input: reply
        })
      });

      if (!audioResponse.ok) {
        throw new Error(`Failed to generate audio: ${audioResponse.status}`);
      }

      // Stream the audio response
      const audioStream = audioResponse.body;
      if (!audioStream) {
        throw new Error("Audio stream is null");
      }

      // Pipe the audio stream to the response
      const reader = audioStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } catch (error) {
        console.error("Error streaming audio:", error);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming audio" });
        }
      }

    } catch (error) {
      console.error("Error in API request:", error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Error processing request",
          details: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  } catch (error) {
    console.error("Error in handler:", error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
}

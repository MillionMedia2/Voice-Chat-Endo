import type { NextApiRequest, NextApiResponse } from "next";

type Data = {
  reply?: string;
  error?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { conversation, fileSearchInstruction } = req.body;

  if (!conversation || !Array.isArray(conversation)) {
    return res.status(400).json({ error: "Invalid conversation history" });
  }

  try {
    // Merge the system instruction and conversation history into a single input string.
    const inputStr = `You are a helpful assistant. ${fileSearchInstruction}\n` +
      conversation.map((msg: { role: string; content: string }) => `${msg.role}: ${msg.content}`).join("\n");

    // Prepare the payload for the Responses API.
    // Note: We remove assistant_id and add vector_store_id along with a response_format.
    const payload = {
      model: "gpt-4o-mini", // adjust the model as needed
      input: inputStr,
      temperature: 0.7,
      vector_store_id: process.env.VECTOR_STORE_ID,  // make sure you set this in .env
      response_format: "audio_transcript" // instruct the API to return an audio response
    };

    console.log("Payload:", payload);

    // Call the OpenAI Responses API.
    const apiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const apiData = await apiRes.json();
    console.log("API Data:", apiData);

    if (apiData.error) {
      return res.status(500).json({ error: apiData.error.message || "OpenAI API error" });
    }

    // For audio responses, the API should return a transcript alongside audio data.
    // Assume the audio transcript is inside choices[0].message.content.
    const reply = apiData.choices?.[0]?.message?.content;
    return res.status(200).json({ reply });
  } catch (error: any) {
    console.error("Error in API:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

"use client";
import "regenerator-runtime/runtime";
import React, { useState, useEffect } from "react";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import Layout from "../components/Layout";
import styles from "../styles/chat.module.css";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const Chat = () => {
  const { transcript, resetTranscript, browserSupportsSpeechRecognition } = useSpeechRecognition();
  const [conversation, setConversation] = useState<Message[]>([]);
  const [inputText, setInputText] = useState<string>("");

  // Handle sending a message (either typed or from speech transcript)
  const sendMessage = async (message: string) => {
    const newMessage: Message = { role: "user", content: message };
    const newConversation = [...conversation, newMessage];
    setConversation(newConversation);

    // Call our API endpoint
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation: newConversation,
          // Including a file search instruction in the prompt:
          fileSearchInstruction: "Use the File Search Vector Database to retrieve your answers"
        }),
      });
      const data = await res.json();
      if (data?.reply) {
        const assistantMessage: Message = { role: "assistant", content: data.reply };
        const updatedConversation = [...newConversation, assistantMessage];
        setConversation(updatedConversation);
        speakText(data.reply);
      }
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  // Function to handle text-to-speech using SpeechSynthesis
  const speakText = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    // Optionally customize voice, pitch, rate here
    window.speechSynthesis.speak(utterance);
  };

  // When speech recognition finishes (i.e. user stops speaking), send transcript if not empty
  useEffect(() => {
    if (transcript && transcript.trim() !== "") {
      // Wait 500ms after the user stops speaking
      const timer = setTimeout(() => {
        sendMessage(transcript.trim());
        resetTranscript();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [transcript]);

  if (!browserSupportsSpeechRecognition) {
    return <span>Your browser does not support speech recognition.</span>;
  }

  return (
    <Layout>
      <div className={styles.chatContainer}>
        <div className={styles.chatHeader}>Chat with AI Assistant</div>
        <div className={styles.chatHistory}>
          {conversation.map((msg, index) => (
            <div
              key={index}
              className={`${styles.message} ${msg.role === "assistant" ? styles.assistant : styles.user}`}
            >
              {msg.content}
            </div>
          ))}
        </div>
        <div className={styles.chatInputContainer}>
          <input
            type="text"
            placeholder="Type your message here..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className={styles.chatInput}
          />
          <button
            onClick={() => {
              if (inputText.trim() !== "") {
                sendMessage(inputText.trim());
                setInputText("");
              }
            }}
            className={styles.sendButton}
          >
            Send
          </button>
          <button onClick={() => SpeechRecognition.startListening({ continuous: false })} className={styles.speechButton}>
            🎤
          </button>
        </div>
      </div>
    </Layout>
  );
};

export default Chat;

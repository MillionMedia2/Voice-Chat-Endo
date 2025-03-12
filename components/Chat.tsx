"use client";
import "regenerator-runtime/runtime";
import React, { useState, useEffect, useRef } from "react";
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
  const [previousResponseId, setPreviousResponseId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Remove the automatic mic start so the mic button is used instead.
  // useEffect(() => {
  //   SpeechRecognition.startListening({ continuous: true });
  // }, []);

  const sendMessage = async (message: string) => {
    // Stop listening when sending a message
    SpeechRecognition.stopListening();

    const newMessage: Message = { role: "user", content: message };
    const newConversation = [...conversation, newMessage];
    setConversation(newConversation);

    const payload: any = {
      conversation: newConversation,
      fileSearchInstruction: "Use the File Search Vector Database to retrieve your answers",
    };

    if (previousResponseId) {
      payload.previous_response_id = previousResponseId;
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data?.reply) {
        if (data.previous_response_id) {
          setPreviousResponseId(data.previous_response_id);
        }
        const assistantMessage: Message = { role: "assistant", content: data.reply };
        const updatedConversation = [...newConversation, assistantMessage];
        setConversation(updatedConversation);
        if (data.audio) {
          playOpenAIAudio(data.audio);
        } else {
          // Resume listening if no audio
          SpeechRecognition.startListening({ continuous: false });
        }
      }
    } catch (error) {
      console.error("Error sending message:", error);
      SpeechRecognition.startListening({ continuous: false });
    }
  };

  const playOpenAIAudio = (base64Audio: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    audioRef.current = new Audio(`data:audio/mp3;base64,${base64Audio}`);
    audioRef.current.play()
      .then(() => {
        console.log("Audio playing...");
      })
      .catch((err) => {
        console.error("Error playing audio:", err);
      });
    audioRef.current.onended = () => {
      SpeechRecognition.startListening({ continuous: false });
    };
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    SpeechRecognition.startListening({ continuous: false });
  };

  // Listen to transcript if the user uses the mic button.
  useEffect(() => {
    if (transcript && transcript.trim() !== "") {
      const timer = setTimeout(() => {
        sendMessage(transcript.trim());
        resetTranscript();
      }, 1500);
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
          <button
            onClick={() => SpeechRecognition.startListening({ continuous: false })}
            className={styles.speechButton}
          >
            🎤
          </button>
          <button
            onClick={stopAudio}
            className={styles.sendButton}
          >
            Stop
          </button>
        </div>
      </div>
    </Layout>
  );
};

export default Chat;

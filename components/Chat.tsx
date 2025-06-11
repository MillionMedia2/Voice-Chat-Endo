"use client";
import "regenerator-runtime/runtime";
import React, { useState, useEffect, useRef, useCallback } from "react";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import Layout from "../components/Layout";
import styles from "../styles/chat.module.css";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

interface AudioState {
  isPlaying: boolean;
  isBuffering: boolean;
  isError: boolean;
  errorMessage: string | null;
  bufferProgress: number;
  currentTime: number;
  duration: number;
  isStreaming: boolean;
}

interface SpeechRecognitionHook {
  transcript: string;
  resetTranscript: () => void;
  browserSupportsSpeechRecognition: boolean;
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

const STORAGE_KEY = 'chat_conversation';
const MAX_MESSAGE_LENGTH = 500;

const Chat = () => {
  const [mounted, setMounted] = useState(false);
  const { 
    transcript, 
    resetTranscript, 
    browserSupportsSpeechRecognition
  } = useSpeechRecognition() as SpeechRecognitionHook;
  const [conversation, setConversation] = useState<Message[]>([]);
  const [inputText, setInputText] = useState<string>("");
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [previousResponseId, setPreviousResponseId] = useState<string | null>(null);
  
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  
  const audioDurationRef = useRef<number>(0);
  const audioStartTimeRef = useRef<number>(0);
  const audioEndTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const [audioState, setAudioState] = useState<AudioState>({
    isPlaying: false,
    isBuffering: false,
    isError: false,
    errorMessage: null,
    bufferProgress: 0,
    currentTime: 0,
    duration: 0,
    isStreaming: false
  });

  const [isStreaming, setIsStreaming] = useState(false);
  // These refs are required for the streaming functionality
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const audioQueue = useRef<Uint8Array[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const isBufferUpdating = useRef(false);

  const [answerType, setAnswerType] = useState<'Standard' | 'Advanced'>('Standard');

  // Load conversation from localStorage on mount
  useEffect(() => {
    const savedConversation = localStorage.getItem(STORAGE_KEY);
    if (savedConversation) {
      try {
        setConversation(JSON.parse(savedConversation));
      } catch (e) {
        console.error('Error loading conversation:', e);
      }
    }
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Save conversation to localStorage whenever it changes
  useEffect(() => {
    if (mounted) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversation));
    }
  }, [conversation, mounted]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [conversation]);

  // Add scroll event listener
  useEffect(() => {
    const chatHistory = chatHistoryRef.current;
    if (chatHistory) {
      const handleScroll = () => {
        const isScrolledUp = chatHistory.scrollHeight - chatHistory.scrollTop - chatHistory.clientHeight > 100;
        setShowScrollButton(isScrolledUp);
      };

      chatHistory.addEventListener('scroll', handleScroll);
      return () => chatHistory.removeEventListener('scroll', handleScroll);
    }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const startListening = useCallback(() => {
    if (browserSupportsSpeechRecognition) {
      setIsListening(true);
      SpeechRecognition.startListening({ continuous: true });
    }
  }, [browserSupportsSpeechRecognition]);

  const handleStreamingAudio = useCallback(async (response: Response) => {
    if (!response.body) {
      console.error("Response body is null");
      throw new Error("Response body is null");
    }

    try {
      console.log("Starting audio streaming process");
      
      setIsStreaming(true);
      setIsAgentSpeaking(true);
      setAudioState(prev => ({ 
        ...prev, 
        isPlaying: true,
        isStreaming: true,
        isBuffering: true
      }));
      
      console.log("Creating new MediaSource");
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      const newMediaSource = new MediaSource();
      console.log("Created new MediaSource, initial state:", newMediaSource.readyState);
      
      if (!audioRef.current) {
        console.error("Audio element not found");
        throw new Error("Audio element not found");
      }
      
      console.log("Setting audio source to MediaSource URL");
      const mediaSourceUrl = URL.createObjectURL(newMediaSource);
      audioRef.current.src = mediaSourceUrl;
      audioRef.current.setAttribute('playsinline', 'true');
      audioRef.current.setAttribute('webkit-playsinline', 'true');
      mediaSourceRef.current = newMediaSource;

      // iOS-specific handling
      if (isIOS) {
        console.log("iOS device detected, using webkitAudioContext");
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContext();
        if (audioRef.current) {
          audioRef.current.setAttribute('playsinline', 'true');
          audioRef.current.setAttribute('webkit-playsinline', 'true');
        }
      }
      
      const sourceBufferPromise = new Promise<SourceBuffer>((resolve, reject) => {
        const sourceOpenHandler = () => {
          console.log("MediaSource opened, state:", newMediaSource.readyState);
          try {
            console.log("Adding source buffer to MediaSource");
            const newSourceBuffer = newMediaSource.addSourceBuffer('audio/mpeg');
            console.log("Source buffer added successfully");
            sourceBufferRef.current = newSourceBuffer;
            resolve(newSourceBuffer);
          } catch (err) {
            console.error("Error setting up source buffer:", err);
            reject(err);
          }
        };
        
        console.log("Adding sourceopen event listener to MediaSource");
        newMediaSource.addEventListener('sourceopen', sourceOpenHandler);
        
        const timeoutId = setTimeout(() => {
          console.warn("MediaSource sourceopen event timed out, current state:", newMediaSource.readyState);
          newMediaSource.removeEventListener('sourceopen', sourceOpenHandler);
          reject(new Error("MediaSource sourceopen event timed out"));
        }, 5000);
        
        newMediaSource.addEventListener('sourceopen', () => {
          console.log("Clearing sourceopen timeout");
          clearTimeout(timeoutId);
        }, { once: true });
      });

      console.log("Waiting for source buffer...");
      const sourceBuffer = await sourceBufferPromise;
      console.log("Source buffer obtained successfully");
      
      if (audioRef.current) {
        console.log("Attempting to play audio");
        try {
          const playPromise = audioRef.current.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              console.log("Audio playback started successfully");
              setAudioState(prev => ({ ...prev, isBuffering: false }));
              
              audioStartTimeRef.current = Date.now();
              
              if (audioEndTimerRef.current) {
                clearTimeout(audioEndTimerRef.current);
                audioEndTimerRef.current = null;
              }
            }).catch(error => {
              console.error("Error playing audio:", error);
              console.log("Adding click listener to play on next user interaction");
              document.addEventListener('click', function playOnClick() {
                console.log("User clicked, attempting to play audio");
                audioRef.current?.play().catch(err => console.error("Error playing on click:", err));
                document.removeEventListener('click', playOnClick);
              }, { once: true });
            });
          }
        } catch (err) {
          console.error("Error in play attempt:", err);
        }
      }

      console.log("Starting to read response stream");
      const reader = response.body.getReader();
      let totalBytesReceived = 0;
      
      const pendingChunks: Uint8Array[] = [];
      let isProcessingChunk = false;
      
      const processNextChunk = async () => {
        if (isProcessingChunk || pendingChunks.length === 0 || !sourceBuffer) {
          return;
        }
        
        isProcessingChunk = true;
        const chunk = pendingChunks.shift();
        
        if (chunk) {
          try {
            if (sourceBuffer.updating) {
              console.log("Source buffer is updating, waiting for updateend");
              await new Promise<void>((resolve) => {
                const updateEndHandler = () => {
                  sourceBuffer.removeEventListener('updateend', updateEndHandler);
                  resolve();
                };
                sourceBuffer.addEventListener('updateend', updateEndHandler);
              });
            }
            
            console.log(`Appending chunk of ${chunk.length} bytes to source buffer`);
            sourceBuffer.appendBuffer(chunk);
            
            await new Promise<void>((resolve) => {
              const updateEndHandler = () => {
                sourceBuffer.removeEventListener('updateend', updateEndHandler);
                resolve();
              };
              sourceBuffer.addEventListener('updateend', updateEndHandler);
            });
          } catch (err) {
            console.error("Error appending chunk:", err);
          }
        }
        
        isProcessingChunk = false;
        
        if (pendingChunks.length > 0) {
          processNextChunk();
        }
      };
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log("Stream complete, total bytes received:", totalBytesReceived);
          break;
        }
        
        totalBytesReceived += value.length;
        console.log(`Received chunk of ${value.length} bytes, total: ${totalBytesReceived}`);
        
        pendingChunks.push(value);
        
        if (!isProcessingChunk) {
          processNextChunk();
        }
      }
      
      while (pendingChunks.length > 0 || isProcessingChunk) {
        console.log(`Waiting for ${pendingChunks.length} pending chunks to be processed`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      console.log("Checking MediaSource state before ending stream:", mediaSourceRef.current?.readyState);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log("MediaSource state after delay:", mediaSourceRef.current?.readyState);
      
      if (mediaSourceRef.current && mediaSourceRef.current.readyState === 'open') {
        console.log("Ending media source stream");
        mediaSourceRef.current.endOfStream();
        console.log("MediaSource stream ended successfully");
      } else {
        console.warn("MediaSource not open when trying to end stream, state:", mediaSourceRef.current?.readyState);
        
        console.log("Waiting longer for MediaSource to open...");
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log("MediaSource state after longer delay:", mediaSourceRef.current?.readyState);
        
        if (mediaSourceRef.current && mediaSourceRef.current.readyState === 'open') {
          console.log("Ending media source stream after longer delay");
          mediaSourceRef.current.endOfStream();
          console.log("MediaSource stream ended successfully after longer delay");
        } else {
          console.warn("MediaSource still not open after longer delay, state:", mediaSourceRef.current?.readyState);
          
          if (audioRef.current) {
            const duration = audioRef.current.duration;
            console.log(`Audio duration: ${duration} seconds`);
            
            if (duration && duration > 0) {
              audioDurationRef.current = duration;
              
              const endTime = duration * 1000 + 500;
              console.log(`Setting timer for ${endTime}ms to detect audio end`);
              
              if (audioEndTimerRef.current) {
                clearTimeout(audioEndTimerRef.current);
              }
              
              audioEndTimerRef.current = setTimeout(() => {
                console.log("Audio end timer fired");
                setIsAgentSpeaking(false);
                setIsStreaming(false);
                setAudioState(prev => ({ 
                  ...prev, 
                  isPlaying: false,
                  isStreaming: false
                }));
              }, endTime);
            }
          }
        }
      }
      
    } catch (err) {
      console.error("Error in streaming audio:", err);
      setError(err instanceof Error ? err.message : "Error streaming audio");
      setAudioState(prev => ({ 
        ...prev, 
        isError: true,
        errorMessage: err instanceof Error ? err.message : "Error streaming audio",
        isStreaming: false
      }));
    } finally {
      console.log("Streaming process completed");
      setIsStreaming(false);
      setAudioState(prev => ({ 
        ...prev, 
        isStreaming: false,
        isBuffering: false
      }));
    }
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    try {
      setIsLoading(true);
      setError(null);
      setAudioState(prev => ({ ...prev, isError: false, errorMessage: null }));

      if (isListening) {
        setIsListening(false);
        SpeechRecognition.stopListening();
      }

      const userMessage: Message = {
        role: "user",
        content: text,
        timestamp: Date.now(),
      };

      setConversation((prev) => [...prev, userMessage]);

      console.log("Sending request to API with previous_response_id:", previousResponseId);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation: [...conversation, userMessage],
          previous_response_id: previousResponseId,
          answerType: answerType
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("API error response:", errorData);
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const responseId = response.headers.get('x-response-id');
      if (responseId) {
        console.log("Received response ID:", responseId);
        setPreviousResponseId(responseId);
      }

      await handleStreamingAudio(response);

    } catch (err) {
      console.error("Error:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
      setAudioState(prev => ({ 
        ...prev, 
        isError: true,
        errorMessage: err instanceof Error ? err.message : "An error occurred"
      }));
    } finally {
      setIsLoading(false);
    }
  }, [conversation, previousResponseId, handleStreamingAudio, isListening, answerType]);

  useEffect(() => {
    if (transcript && !isLoading) {
      const timeoutId = setTimeout(() => {
        if (transcript.split(' ').length > 1) {
          console.log("Sending transcript:", transcript);
          sendMessage(transcript);
          resetTranscript();
        }
      }, 1500);

      return () => clearTimeout(timeoutId);
    }
  }, [transcript, isLoading, resetTranscript, sendMessage]);

  const clearConversation = useCallback(() => {
    if (window.confirm('Are you sure you want to clear the conversation?')) {
      setConversation([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const exportConversation = useCallback(() => {
    const text = conversation
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "conversation.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [conversation]);

  const scrollToBottom = () => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  };

  const toggleListening = useCallback(() => {
    if (isListening) {
      // Case 1: Mic is pulsing -> Turn it off (end session)
      console.log("Stopping microphone - ending session");
      setIsListening(false);
      SpeechRecognition.stopListening();
      return; // Exit early to prevent any other state changes
    } else if (isAgentSpeaking || isStreaming) {
      // Case 2: Audio is playing (stop button) -> Stop audio and start mic
      console.log("Stopping audio playback");
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setIsAgentSpeaking(false);
        setAudioState(prev => ({ ...prev, isPlaying: false }));
      }
      
      if (sourceBufferRef.current) {
        try {
          if (mediaSourceRef.current && mediaSourceRef.current.readyState === 'open') {
            console.log("Aborting source buffer");
            sourceBufferRef.current.abort();
          } else {
            console.log("MediaSource not open, skipping source buffer abort");
          }
        } catch (err) {
          console.error("Error aborting source buffer:", err);
        }
      }
      
      if (mediaSourceRef.current) {
        try {
          if (mediaSourceRef.current.readyState === 'open') {
            console.log("Ending media source");
            mediaSourceRef.current.endOfStream();
          } else {
            console.log("MediaSource not open, skipping endOfStream");
          }
        } catch (err) {
          console.error("Error ending media source:", err);
        }
      }
      
      if (audioEndTimerRef.current) {
        clearTimeout(audioEndTimerRef.current);
        audioEndTimerRef.current = null;
      }
      
      setIsStreaming(false);
      setAudioState(prev => ({ 
        ...prev, 
        isPlaying: false,
        isStreaming: false
      }));
      
      // Start mic after stopping audio
      if (browserSupportsSpeechRecognition) {
        console.log("Starting microphone after stopping audio");
        setIsListening(true);
        SpeechRecognition.startListening({ continuous: true });
      }
    } else {
      // Case 3: Static mic -> Start new session
      if (browserSupportsSpeechRecognition) {
        console.log("Starting new session - starting speech recognition");
        setIsListening(true);
        SpeechRecognition.startListening({ continuous: true });
      }
    }
  }, [isListening, isAgentSpeaking, isStreaming, browserSupportsSpeechRecognition, sourceBufferRef, mediaSourceRef]);

  useEffect(() => {
    if (audioRef.current) {
      const handleAudioEnded = () => {
        console.log("Audio ended event fired");
        setIsAgentSpeaking(false);
      };
      
      audioRef.current.addEventListener('ended', handleAudioEnded);
      
      return () => {
        if (audioRef.current) {
          audioRef.current.removeEventListener('ended', handleAudioEnded);
        }
      };
    }
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
      
      if (audioEndTimerRef.current) {
        clearTimeout(audioEndTimerRef.current);
        audioEndTimerRef.current = null;
      }
    };
  }, []);

  if (!mounted) {
    return null;
  }

  if (!browserSupportsSpeechRecognition) {
    return <span>Your browser does not support speech recognition.</span>;
  }

  return (
    <Layout>
      <div className={styles.chatContainer}>
        <div className={styles.chatHeader}>
          <span>Plantz Endometriosis Specialist</span>
          <div className={styles.headerButtons}>
            <div className={styles.headerDropdown}>
              <select
                value={answerType}
                onChange={(e) => setAnswerType(e.target.value as 'Standard' | 'Advanced')}
                className={styles.dropdownSelect}
              >
                <option value="Standard">Standard</option>
                <option value="Advanced">Advanced</option>
              </select>
            </div>
            <button 
              onClick={clearConversation} 
              className={styles.headerButton} 
              aria-label="Clear conversation"
              data-tooltip="Clear"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
            <button 
              onClick={exportConversation} 
              className={styles.headerButton} 
              aria-label="Export conversation"
              data-tooltip="Download"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
          </div>
        </div>
        <audio
          ref={audioRef}
          playsInline
          webkit-playsinline="true"
          onEnded={() => {
            console.log("Audio playback ended - Initial state:", {
              isAgentSpeaking,
              isStreaming,
              isListening,
              audioState: { ...audioState }
            });
            
            // Update states first
            setIsAgentSpeaking(false);
            setIsStreaming(false);
            setAudioState(prev => ({ 
              ...prev, 
              isPlaying: false,
              isStreaming: false,
              isBuffering: false
            }));

            // Start microphone after a short delay
            setTimeout(() => {
              if (browserSupportsSpeechRecognition) {
                console.log("Starting microphone after audio finished");
                setIsListening(true);
                SpeechRecognition.startListening({ continuous: true });
              }
            }, 100);
          }}
          onError={(e) => {
            // Ignore errors that occur during natural playback completion
            if (!isAgentSpeaking && !isStreaming) {
              console.log("Ignoring error during playback completion");
              return;
            }
            console.error("Audio error:", e);
            setError("Error playing audio");
            setAudioState(prev => ({ 
              ...prev, 
              isError: true,
              errorMessage: "Error playing audio"
            }));
          }}
          style={{ display: 'none' }}
        />
        {error && (
          <div className={styles.errorMessage}>
            {error}
          </div>
        )}
        {audioState.isError && audioState.errorMessage && (
          <div className={styles.errorMessage}>
            {audioState.errorMessage}
          </div>
        )}
        <div className={styles.chatHistory} ref={chatHistoryRef}>
          {conversation.map((msg, index) => (
            <div
              key={index}
              className={`${styles.message} ${msg.role === "assistant" ? styles.assistant : styles.user}`}
            >
              <div className={styles.messageContent}>{msg.content}</div>
              <div className={styles.messageTimestamp}>
                {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
              </div>
            </div>
          ))}
          {(isLoading || audioState.isBuffering) && (
            <div className={styles.loadingMessage}>
              <div className={styles.loadingSpinner}></div>
              {audioState.isBuffering ? 'Loading audio...' : 'Thinking...'}
            </div>
          )}
          {showScrollButton && (
            <button 
              onClick={scrollToBottom}
              className={styles.scrollButton}
              aria-label="Scroll to bottom"
            >
              ⬇️
            </button>
          )}
        </div>
        <div className={styles.chatInputContainer}>
          <div className={styles.inputWrapper}>
            <input
              type="text"
              placeholder="Type here or click mic to start chat"
              value={inputText}
              onChange={(e) => {
                if (e.target.value.length <= MAX_MESSAGE_LENGTH) {
                  setInputText(e.target.value);
                }
              }}
              className={styles.chatInput}
              disabled={isLoading}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (inputText.trim() !== "") {
                    sendMessage(inputText.trim());
                    setInputText("");
                  }
                }
              }}
            />
            <div className={styles.charCount}>
              {inputText.length}/{MAX_MESSAGE_LENGTH}
            </div>
          </div>
          <button
            onClick={() => {
              if (inputText.trim() !== "") {
                sendMessage(inputText.trim());
                setInputText("");
              }
            }}
            className={styles.sendButton}
            disabled={isLoading || inputText.length === 0}
          >
            Send
          </button>
          <button
            onClick={toggleListening}
            className={`${styles.speechButton} ${isListening ? styles.active : ''} ${(isAgentSpeaking || isStreaming) ? styles.active : ''}`}
            disabled={isLoading}
            aria-label={isAgentSpeaking || isStreaming ? "Stop audio" : isListening ? "Stop listening" : "Start listening"}
          >
            {isAgentSpeaking || isStreaming ? (
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : isListening ? (
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            ) : (
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </Layout>
  );
};

export default Chat;

import dynamic from "next/dynamic";

// Dynamically import the Chat component with SSR disabled
const ChatComponent = dynamic(() => import("../components/Chat"), { ssr: false });

export default function ChatPage() {
  return <ChatComponent />;
}

// The full-page Chat surface (reached from the nav). It reuses the CopilotBar in `fullPage` mode (no
// modal chrome) and shares the same conversation history as the quick top-bar palette — one assistant,
// two depths. App drives which view it opens on (the chats list, a fresh chat, or a specific saved one)
// and seeds a first message when the top-bar search escalates a draft here.
import { CopilotBar } from "../components/CopilotBar";
import type { Navigate } from "../components/TabNav";
import "./ChatTab.css";

export function ChatTab({
  onNavigate,
  onOpenAccount,
  view = "search",
  openChatId,
  seedPrompt,
  onChatsChanged,
}: {
  onNavigate: Navigate;
  onOpenAccount?: (org: string) => void;
  view?: "search" | "history" | "chat";
  openChatId?: string;
  seedPrompt?: string;
  onChatsChanged?: () => void;
}) {
  return (
    <div className="chat-tab">
      <CopilotBar
        fullPage
        initialView={view}
        openChatId={openChatId}
        seedPrompt={seedPrompt}
        onChatsChanged={onChatsChanged}
        onNavigate={onNavigate}
        onOpenAccount={onOpenAccount}
        onClose={() => {}}
      />
    </div>
  );
}

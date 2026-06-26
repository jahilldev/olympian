import Chat from './Chat.tsx';
import ChatList from './ChatList.tsx';

/** Routes the single /chats shell: a session id in the path → conversation, else the list. */
export default function ChatIndex() {
  const parts = window.location.pathname.split('/').filter(Boolean); // ['chats'] | ['chats', id]
  return parts.length > 1 ? <Chat /> : <ChatList />;
}

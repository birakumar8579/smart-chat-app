const onlineUsers = new Map();

export const getOnlineUsers = () => onlineUsers;
export const isUserOnline = (userId) => onlineUsers.has(userId.toString());
export const getOnlineUserCount = () => onlineUsers.size;

export default onlineUsers;
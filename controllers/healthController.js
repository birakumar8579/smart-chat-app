export const getHealth = (_req, res) => {
  res.status(200).json({
    success: true,
    message: "SMARTCHATAPPLICATION backend is running",
    timestamp: new Date().toISOString(),
  });
};

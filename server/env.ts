// Imported first so every module sees .env values at load time.
try { process.loadEnvFile('.env'); } catch { /* in production the host provides env vars */ }

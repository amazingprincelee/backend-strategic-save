import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';

// Import configurations and middleware
import connectDB from './config/database.js';
import { 
  corsOptions, 
  helmetConfig, 
  generalLimiter, 
  securityHeaders, 
  sanitizeRequest 
} from './middleware/security.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

// Import routes
import apiRoutes from './routes/index.js';

// Import services
import blockchainService from './utils/blockchainService.js';
import emailService from './utils/emailService.js';
import { initializeBackgroundFetch } from './services/Arbitrage/fetchPrices.js';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const server = createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || corsOptions.origin || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  allowEIO3: true,
});

// Trust proxy (important for rate limiting and IP detection)
app.set('trust proxy', 1);

// Security middleware
app.use(helmetConfig);
app.use(securityHeaders);
app.use(sanitizeRequest);

// CORS
import cors from 'cors';
app.use(cors(corsOptions));

// Rate limiting
app.use(generalLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Make io accessible to routes
app.set('io', io);
app.use((req, res, next) => {
  req.io = io;
  next();
});

// API routes
app.use('/api', apiRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Strategic Crypto Trader API',
    version: '1.0.0',
    documentation: '/api/health',
    timestamp: new Date().toISOString()
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Join user-specific room for notifications
  socket.on('join-user-room', (userAddress) => {
    if (userAddress) {
      socket.join(`user:${userAddress.toLowerCase()}`);
      console.log(`User ${userAddress} joined their room`);
    }
  });

  // Leave user room
  socket.on('leave-user-room', (userAddress) => {
    if (userAddress) {
      socket.leave(`user:${userAddress.toLowerCase()}`);
      console.log(`User ${userAddress} left their room`);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// Error handling middleware (must be last)
app.use(notFound);
app.use(errorHandler);

// Initialize services and start server
const startServer = async () => {
  try {
    // Connect to database
    console.log('🔗 Connecting to database...');
    await connectDB();
    console.log('✅ Database connected successfully');

    // Email service is already initialized on import
    console.log('✅ Email service initialized');

    // Blockchain service is already initialized on import
    console.log('✅ Blockchain service initialized');

    // Initialize arbitrage background fetch service
    console.log('🔄 Initializing arbitrage service...');
    initializeBackgroundFetch();
    console.log('✅ Arbitrage service initialized');

    // Start server
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 API URL: http://localhost:${PORT}/api`);
      console.log(`🔌 Socket.IO URL: http://localhost:${PORT}`);
      console.log(`🔌 Socket.IO Path: /socket.io/`);
      console.log(`📊 Arbitrage Status: http://localhost:${PORT}/api/arbitrage/status`);
      console.log(`💰 Arbitrage Opportunities: http://localhost:${PORT}/api/arbitrage/fetch-opportunity`);
      console.log(`${'='.repeat(50)}\n`);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`\n🔴 Received ${signal}. Starting graceful shutdown...`);
  
  // Check if server is listening before trying to close it
  if (server && server.listening) {
    server.close(() => {
      console.log('🔌 HTTP server closed');
      
      // Close database connection
      import('./config/database.js').then(({ default: mongoose }) => {
        mongoose.connection.close(() => {
          console.log('🗄️  Database connection closed');
          process.exit(0);
        });
      });
    });
  } else {
    console.log('🔌 HTTP server was not running');
    
    // Still try to close database connection
    import('./config/database.js').then(({ default: mongoose }) => {
      mongoose.connection.close(() => {
        console.log('🗄️  Database connection closed');
        process.exit(0);
      });
    }).catch(() => {
      process.exit(1);
    });
  }

  // Force close after 30 seconds
  setTimeout(() => {
    console.error('⚠️  Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

// Handle process termination
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Export for testing
export { app, server, io };

// Start the server
startServer();
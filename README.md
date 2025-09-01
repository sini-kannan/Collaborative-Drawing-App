# Collaborative Drawing App

A real-time collaborative drawing application built with React, Node.js, Socket.io, and Redis.

## Features

- Real-time drawing synchronization across multiple users
- Multiple colors and brush sizes
- Clean and responsive UI
- Redis for horizontal scaling
- Docker support for easy deployment

## Prerequisites

- Docker and Docker Compose
- Node.js (for local development without Docker)

## Getting Started

### With Docker (Recommended)

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd collaborative-drawing-app
   ```

2. Start the application:
   ```bash
   docker-compose up --build
   ```

3. Open your browser and navigate to:
   ```
   http://localhost
   ```

### Without Docker

#### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the backend server:
   ```bash
   npm start
   ```

#### Frontend Setup

1. In a new terminal, navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

4. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Development

### Environment Variables

Create a `.env` file in the backend directory with the following variables:

```
NODE_ENV=development
REDIS_URL=redis://localhost:6379
```

### Available Scripts

#### Backend

- `npm start` - Start the production server
- `npm run dev` - Start the development server with nodemon

#### Frontend

- `npm start` - Start the development server
- `npm run build` - Build for production
- `npm test` - Run tests
- `npm run eject` - Eject from create-react-app

## Deployment

### Docker

Build and push the Docker images:

```bash
docker-compose build
docker-compose push
```

### Cloud Platforms

#### Heroku

1. Install the Heroku CLI
2. Login to Heroku:
   ```bash
   heroku login
   ```
3. Create a new Heroku app:
   ```bash
   heroku create
   ```
4. Add Redis addon:
   ```bash
   heroku addons:create heroku-redis:hobby-dev
   ```
5. Deploy:
   ```bash
   git push heroku main
   ```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

# Step 1: Build the Next.js application
# Use a Node.js base image
FROM node:20 as builder

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to work directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application source code
COPY . .

# Build Application
RUN npm run build

# # Step 2: Run the application
# # Use a smaller node base image for the runtime
# FROM node:20-alpine

# # Set the working directory
# WORKDIR /app

# Expose the port the app runs on
EXPOSE 3000

# Command to run the app
CMD ["npm", "run", "start"]

# Trades

This project is an Electron application optimized for macOS that performs trades of ERC20 token transfers.

## Features

- **File Management:** Import and manage files containing source/destination addresses and private keys.
- **Automated Trades:** Execute ERC20 trades.
- **Security:** Secure storage of private keys using AES-256 encryption.
- **Real-Time Monitoring:** Detailed, real-time logs and history of trades.
- **Optimized UX/UI:** macOS-optimized interface with advanced error handling and user feedback.
- **Testing & Linting:** Pre-configured ESLint and Jest for code quality and testing.

## Prerequisites

- **Node.js:** Version 14.x or later.
- **npm or Yarn:** Package manager of your choice.
- **macOS:** For an optimized user experience (although Electron apps can run on other platforms).

## Installation

Follow these steps to get your development environment set up:

1. **Clone the Repository:**

   Open your terminal and clone the repository to your local machine:

   ```bash
   git clone https://github.com/QChab/Trades.git
   cd Trades
   ```

2. **Install Dependencies:**

    Install all necessary dependencies using npm:

    Using npm:

    ```bash
    npm install
    ```

3. **Running the Application:**
    To build the vue app in /vue-dist :
    ```bash
    npm run vite:dev
    ```

    To launch the Electron application in development mode:

    ```bash
    npm start
    ```
    When modifying an element, refresh the app to trigger modifications

    Note: When NODE_ENV is set to development, the Electron Developer Tools will open automatically.


4. **Build the App:**

    ```bash
    npm run build
    ```
    This command builds the vue project, then uses electron-builder and the configuration specified in electron-builder.json to create a distributable package (e.g., DMG for macOS).


Build: 
```
npm run build
xcrun notarytool submit "./dist/trades-1.0.7-arm64.dmg" --apple-id "thibault@techinblocks.com" --password "txuv-flqw-bboi-yhqj" --team-id "BAXBQTTS3U" --wait --progress
xcrun stapler staple "dist/trades-1.0.7-arm64.dmg"
scp dist/trades-1.0.7-arm64.dmg game:~/drive/
```
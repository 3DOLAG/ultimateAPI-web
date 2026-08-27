# AURA Game - Reseller Store Platform

A modern e-commerce and reseller platform for digital gaming cards, game top-ups, software licenses, and subscription codes.

## 🚀 Features

- **Modern & Responsive UI**: Sleek dark-mode aesthetic with animations and responsive layout.
- **Supplier API Integration**: Automated synchronization with supplier catalog, balance checks, and real-time order processing.
- **Discord OAuth2 & Webhooks**: Secure Discord-based admin login and live order notification webhooks.
- **Dynamic Pricing**: Configurable profit margins with automated pricing rules.
- **Admin Dashboard**: Analytics, order management, category filtering, manual order status updates, and supplier balance monitoring.
- **Custom Payment Proof Uploads**: Integrated receipt/proof upload system for offline/manual payment methods.

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: SQLite3
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Authentication**: Discord OAuth2 & Session Cookies
- **Scheduler**: Node-Cron for catalog & balance synchronization

---

## 📦 Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- [Git](https://git-scm.com/)

### 2. Installation

Clone the repository and install dependencies:

```bash
git clone <YOUR_REPOSITORY_URL>
cd <REPOSITORY_FOLDER>
npm install
```

### 3. Configuration

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your API keys, Discord app credentials, and store settings.

### 4. Running the Server

Start the server locally:

```bash
npm start
```

Default access URLs:
- **Storefront**: `http://localhost:3000/`
- **Admin Dashboard**: `http://localhost:3000/dashboard.html`

---

## 🔒 Security & Privacy Note

- Never commit your `.env` file or sensitive API keys to public repositories.
- Keep your session secrets and admin keys protected.

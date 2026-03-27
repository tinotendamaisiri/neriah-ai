# Neriah — AI Homework Marking Assistant

Neriah helps African teachers mark student exercise books in seconds. Photograph a student's book; Neriah grades every answer and returns an annotated image with ticks, crosses, and a score.

## Channels
- **Mobile App** (React Native / Expo) — primary, with live camera guidance
- **WhatsApp Bot** — lightweight fallback, no app install required

## Quick Start

### Backend (local)
```bash
cd backend
cp ../local.settings.json.example local.settings.json
# fill in your Azure service credentials
pip install -r requirements.txt
func start
```

### Mobile App
```bash
cd app/mobile
npm install
npx expo start
```

### Web Dashboard
```bash
cd app/web
npm install
npm run dev
```

### Infrastructure (deploy to Azure)
```bash
bash scripts/deploy.sh dev
```

## Docs
- [Architecture](docs/architecture.md)
- [WhatsApp Flow](docs/whatsapp-flow.md)
- [Data Models](docs/data-models.md)
- [Project Context for Claude Code](CLAUDE.md)

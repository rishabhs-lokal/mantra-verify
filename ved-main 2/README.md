# Ved — React + TypeScript frontend

## Frontend

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Python backend

In a second terminal:

```bash
python -m venv .venv
```

Activate it, then:

```bash
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Vite proxies `/api` calls to FastAPI on port 8000.

## Production build

```bash
npm run build
```

The compiled frontend is written to `dist/`.

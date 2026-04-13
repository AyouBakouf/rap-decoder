# RAP DECODER 翻

Traducteur rap : recherche les paroles en ligne, traduit ligne par ligne en français, et décrypte le slang / les refs / le wordplay.

## Déployer sur Vercel (gratuit)

### 1. Push sur GitHub

```bash
git init
git add .
git commit -m "rap decoder"
gh repo create rap-decoder --public --push
```

Ou crée le repo manuellement sur github.com et push.

### 2. Importer sur Vercel

1. Va sur [vercel.com](https://vercel.com), connecte-toi avec GitHub
2. "Add New Project" → importe `rap-decoder`
3. Framework Preset: **Vite**
4. **Environment Variables** → ajoute :
   - `ANTHROPIC_API_KEY` = ta clé API Anthropic (commence par `sk-ant-...`)
5. Deploy

### 3. Clé API Anthropic

- Va sur [console.anthropic.com](https://console.anthropic.com)
- Crée un compte si t'en as pas
- Settings → API Keys → Create Key
- Copie la clé et colle-la dans les env vars Vercel

### Coût

Chaque morceau = ~1 appel API Claude Sonnet avec web search. Compte environ $0.01-0.03 par morceau. Un album de 14 tracks ≈ $0.20-0.40.

## Dev local

```bash
npm install
npm run dev
```

Pour le dev local, crée un fichier `.env` à la racine :

```
ANTHROPIC_API_KEY=sk-ant-...
```

Le proxy Vite redirige `/api/*` vers le serverless function.

## Stack

- **Frontend** : React + Vite
- **Backend** : Vercel Serverless Function (proxy API)
- **API** : Claude Sonnet 4 + Web Search

# RAP DECODER 翻

Traducteur rap : paroles + traduction FR + décryptage des refs. Gemini 3 Flash + Google Search. Un album complet pour 7 centimes.

## Pourquoi

On a tous un pote qui écoute 5 rappeurs et qui pense avoir fait le tour du genre. C'est pas de sa faute, c'est juste que personne lui a filé les clés pour écouter le reste. Quand t'as pas le contexte, du Ka ça ressemble à un mec qui marmonne, du billy woods c'est du charabia et Racionais MC's c'est juste du portugais.

Ce tool, tu lui donnes un album, il va chercher les paroles, les traduit ligne par ligne en français et t'explique : le slang de Memphis, les refs bibliques, les métaphores politiques, le wordplay planqué. Ça marche en anglais, portugais, turc, russe, polonais, espagnol, japonais, français...

Le rap c'est le genre musical le plus riche en texte qui existe et la plupart des gens en écoutent 2% parce que la barrière de la langue ou la densité fait peur. Ce truc est là pour casser cette barrière.

## Déployer (gratuit)

### 1. Clé API Gemini

1. Va sur [aistudio.google.com](https://aistudio.google.com)
2. "Get API key" → Create (gratuit, pas de CB)
3. Copie la clé (commence par `AIza...`)

### 2. Push sur GitHub

```bash
git init
git add .
git commit -m "init"
```

Crée un repo sur github.com, puis :

```bash
git remote add origin https://github.com/TON-USERNAME/rap-decoder.git
git branch -M main
git push -u origin main
```

### 3. Vercel

1. Va sur [vercel.com](https://vercel.com) → "Add New Project" → importe le repo
2. Framework : **Vite**
3. Environment Variables → `GEMINI_API_KEY` = ta clé
4. Deploy

C'est en ligne.

## Coût

| | Prix |
|---|---|
| 1 morceau | ~$0.005 |
| 1 album (14 tracks) | ~$0.07 |
| 100 albums | ~$7 |

## Stack

- **Frontend** : React + Vite
- **Backend** : Vercel Serverless Function
- **API** : Gemini 3 Flash + Google Search

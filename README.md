# RAP DECODER 翻

Traducteur rap : paroles + traduction FR + décryptage des refs. Gemini 2.5 Flash (via OpenRouter) + Perplexity Sonar. Un album complet pour 7 centimes.

<img width="1000" height="1000" alt="image" src="https://github.com/user-attachments/assets/1eb93c6b-b8a4-4d5b-852c-2d99228e5d7a" />


## Pourquoi

On a tous un pote qui écoute 5 rappeurs et qui pense avoir fait le tour du genre. C'est pas de sa faute, c'est juste que personne lui a filé les clés pour écouter le reste. Quand t'as pas le contexte, du Ka ça ressemble à un mec qui marmonne, du billy woods c'est du charabia et Racionais MC's c'est juste du portugais.

<img width="500" height="500" alt="image" src="https://github.com/user-attachments/assets/ee72e29b-aeb0-4123-a2dd-42dae0d5803f" />



Ce tool, tu lui donnes un album, il va chercher les paroles, les traduit ligne par ligne en français et t'explique : le slang de Memphis, les refs bibliques, les métaphores politiques, le wordplay planqué.

Ça marche en anglais, portugais, turc, russe, polonais, espagnol, japonais, français...

Le rap c'est le genre musical le plus riche en texte qui existe et la plupart des gens en écoutent 2% parce que la barrière de la langue ou la densité fait peur. Ce truc est là pour casser cette barrière.

<img width="500" height="500" alt="image" src="https://github.com/user-attachments/assets/b12d19e0-428f-47db-9a06-a74672f07a36" />

## Déployer

### 1. Clés API

**OpenRouter** (obligatoire — c'est lui qui route vers Gemini et Sonar)

1. Va sur [openrouter.ai/keys](https://openrouter.ai/keys)
2. Create Key → copie-la (commence par `sk-or-v1-...`)
3. Crédite le compte (les modèles utilisés sont facturés à l'usage, voir section Coût)

**Genius** (obligatoire — récupération des paroles)

1. Va sur [genius.com/api-clients](https://genius.com/api-clients)
2. New API Client → génère un **Client Access Token**

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
3. Environment Variables :
   | Variable | Valeur | Requis |
   |---|---|---|
   | `OPENROUTER_API_KEY` | `sk-or-v1-...` | oui |
   | `GENIUS_API_TOKEN` | ton Client Access Token | oui |
   | `GEMINI_MODEL` | défaut `google/gemini-2.5-flash` | non |
   | `DEEPSEEK_MODEL` | défaut `deepseek/deepseek-r1-0528` | non |
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
- **API** : OpenRouter → Gemini 2.5 Flash (décryptage) + Perplexity Sonar (fallback paroles) + Genius (paroles)

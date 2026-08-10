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

**Le décodage** (il en faut une des deux, `GOOGLE_API_KEY` prioritaire)

*Option gratuite — Google AI Studio*

1. Va sur [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Create API key → copie-la (commence par `AIza...`)
3. Tier gratuit, pas de carte bancaire

> Un abonnement Gemini Pro ne remplace **pas** cette clé : il n'ouvre aucun quota API, il ne vaut que dans l'interface AI Studio et l'app Gemini.

*Option payante — OpenRouter*

1. Va sur [openrouter.ai/keys](https://openrouter.ai/keys)
2. Create Key → copie-la (commence par `sk-or-v1-...`)
3. Crédite le compte (facturé à l'usage, voir section Coût)

Sans OpenRouter crédité, le décodage et la traduction marchent parfaitement sur la clé Google gratuite, mais tout ce qui exige une **recherche web** tombe : le mode Album affiche « Album introuvable » sur les artistes peu référencés, faute de tracklist. L'outil `google_search` ne sauve rien — son quota est séparé de celui du modèle et il est nul sur le tier gratuit.

C'est le rôle de `SEARCH_VIA_OPENROUTER=1` : seuls ces appels de recherche repassent chez Sonar (~$0.005 la requête), le décodage restant gratuit sur Google.

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
   | `GOOGLE_API_KEY` | `AIza...` | une des deux |
   | `OPENROUTER_API_KEY` | `sk-or-v1-...` | une des deux |
   | `GENIUS_API_TOKEN` | ton Client Access Token | oui |
   | `GEMINI_MODEL` | défaut `gemini-3.6-flash` (Google) / `google/gemini-2.5-flash` (OpenRouter) | non |
   | `DEEPSEEK_MODEL` | défaut `deepseek/deepseek-v4-pro` | non |
   | `SEARCH_VIA_OPENROUTER` | `1` si OpenRouter est crédité | recommandé |
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

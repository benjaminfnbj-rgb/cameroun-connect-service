# Cameroun Connect Service — site vitrine

Site officiel : https://www.comconnectservice.com (hébergé sur Vercel).

## Structure

- `public/` : le site publié (page d'accueil FR, `en/` pour l'anglais, pages légales, polices, CSS, JS).
- `api/contact.js` : fonction serveur qui envoie les messages du formulaire de contact par e-mail (via Resend).
- `tests/` : tests automatiques.

## Activer l'envoi d'e-mails (à faire une seule fois)

1. Créer un compte gratuit sur https://resend.com.
2. Dans Resend > Domains, ajouter `comconnectservice.com` et copier les enregistrements DNS indiqués chez votre fournisseur de nom de domaine. Attendre que le domaine soit « Verified ».
3. Dans Resend > API Keys, créer une clé (permission « Sending access »).
4. Dans Vercel > projet > Settings > Environment Variables, ajouter :
   - `RESEND_API_KEY` = la clé créée (obligatoire)
   - `CONTACT_TO` = l'adresse qui reçoit les messages (facultatif, par défaut `contact@comconnectservice.com`)
   - `CONTACT_FROM` = l'expéditeur, par ex. `Cameroun Connect Service <contact@comconnectservice.com>` (facultatif)
5. Redéployer le site.

Tant que la clé n'est pas configurée, le formulaire affiche un message d'erreur invitant à écrire directement par e-mail : il n'affiche jamais « message envoyé » si l'e-mail n'est pas réellement parti.

## Tester avant de déployer

```bash
npm test                    # tests de la fonction d'envoi (Resend simulé)
node tests/site.e2e.js      # tests dans un navigateur : pages, liens, mobile, formulaire
node tests/local-server.js  # aperçu local sur http://localhost:3000
```

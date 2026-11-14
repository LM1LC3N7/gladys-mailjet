# Mailjet pour Gladys

Intégration non officielle, sans lien avec Mailjet. Elle **envoie** des e-mails via votre compte Mailjet avec
l’API Send v3.1 ; elle n’en lit jamais. Cette intégration n’a jamais été testée avec un vrai compte Mailjet :
elle a été construite d’après la documentation officielle de Mailjet et testée sur de faux serveurs locaux.
Les retours sont les bienvenus.

## Ce qui part, et quand

Un e-mail ne part que par l’un de ces trois chemins :

1. **Un message de Gladys** à un utilisateur qui a saisi son adresse dans le bloc **Mon compte** de
   l’intégration : l’action de scène « Envoyer un message », et les messages système de Gladys (mise à jour
   faite, sauvegarde échouée, pile faible…) quand l’administrateur les dirige vers tous les canaux ou vers
   celui-ci (paramètres système). Un utilisateur qui laisse l’adresse vide ne reçoit rien par e-mail. L’image
   de caméra de l’action « Envoyer une image de caméra » est jointe (JPEG, PNG ou WebP, 2 Mo au plus).
2. **L’action de scène « Envoyer un e-mail avec Mailjet »** : un e-mail en texte brut à une adresse, avec un
   objet facultatif (sinon l’objet de la configuration). Sa sortie `message_id` est l’identifiant Mailjet de
   l’e-mail.
3. **Le bouton Tester**, en **mode bac à sable** de Mailjet : Mailjet vérifie les clés, l’expéditeur et
   l’adresse et ne distribue rien (non compté dans le plafond horaire).

Rien n’est envoyé au démarrage ni à intervalle régulier.

## Mise en place

1. Dans Mailjet, **Paramètres du compte → API REST → Gestion des clés API** : copiez la clé d’API et la clé
   secrète.
2. **Expéditeurs et domaines** : validez l’adresse de l’expéditeur (ou tout son domaine). Sans cela, Mailjet
   refuse chaque e-mail (« pas l’adresse de l’expéditeur »).
3. Dans Gladys, saisissez les clés, l’adresse de l’expéditeur, au besoin le nom de l’expéditeur, l’objet des
   messages de Gladys et le plafond horaire ; enregistrez, puis cliquez sur **Tester**.
4. Chaque utilisateur saisit son adresse dans **Mon compte**.

La clé secrète est gardée par Gladys dans sa base, jamais réaffichée, et envoyée seulement à Mailjet.

## Ce qui protège votre compte et votre forfait

- **Plafond horaire** (20 par défaut, de 1 à 200) : au plus ce nombre d’e-mails sur 60 minutes glissantes,
  messages de Gladys et actions de scène ensemble. Au-delà, rien n’est envoyé et l’action échoue avec l’heure
  du prochain e-mail possible. Le compte est gardé dans `/data` aux redémarrages. Un e-mail est compté avant
  de partir ; il n’est décompté que si Mailjet a répondu qu’il le refusait (rien envoyé).
- **Jamais envoyé deux fois** : l’intégration ne renvoie aucun e-mail, quoi qu’il arrive (pas de réponse,
  connexion coupée, erreur du serveur). Quand Mailjet n’a pas confirmé, l’action échoue avec « il a pu être
  envoyé, il n’est donc pas renvoyé ».
- **Messages de Gladys** : Gladys attend 5 secondes une réponse. Si Mailjet est plus lent, l’intégration
  répond au bout de 3,5 secondes « sans réponse pour l’instant » et laisse la requête se terminer (20
  secondes au plus) ; le statut dit ensuite comment cela s’est passé. Un e-mail qui attend encore son tour à
  ce moment-là est abandonné et ne part pas.
- **Au plus 2 e-mails à la fois**, 10 en attente ; au-delà, « trop d’e-mails à la fois » et rien n’est
  envoyé.
- **Ralentir** : après un 429 (trop de requêtes) ou une erreur du serveur Mailjet, rien n’est envoyé pendant
  60 secondes, durée doublée à chaque nouvel échec jusqu’à 1 heure (un `Retry-After` de Mailjet est suivi
  jusqu’à 6 heures), Tester compris. La pause est gardée dans `/data`.
- **Clés refusées** (HTTP 401) : plus rien n’est envoyé avec ces clés tant qu’elles ne changent pas ou que le
  bouton Tester ne réussit pas (le bouton Tester essaie aussi des clés refusées, hors pause). Seuls 8 bits d’une empreinte salée sont
  gardés dans `/data`, jamais une clé. Un 403 (expéditeur non validé, envoi refusé) ou une adresse refusée
  n’est pas un refus des clés.

## Statut

| Statut                                                                  | Sens                                                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Prêt                                                                    | Clés et expéditeur saisis ; vérifiés par Mailjet au premier e-mail ou avec le bouton Tester.          |
| Mailjet a accepté le dernier e-mail                                     | Avec le compte de la dernière heure et le plafond.                                                    |
| Mailjet a accepté les clés et l’expéditeur                              | Le dernier test a réussi (rien n’a été distribué).                                                    |
| Clés refusées / expéditeur non validé / pause / plafond horaire atteint | Rien n’est envoyé ; le texte dit jusqu’à quand ou quoi changer.                                       |
| Compteur horaire non enregistré                                         | `/data` est non lu, en lecture seule ou lent : le plafond ne tient que jusqu’au prochain redémarrage. |

## Vie privée

Les journaux montrent les adresses masquées (`j***@e***.com`) ; les clés, objets et textes ne sont jamais
journalisés, mis dans le statut ni écrits dans `/data`. `/data/mailjet.json` contient les heures des e-mails
de la dernière heure, la pause et l’empreinte des clés refusées.

## Limites

- Texte brut seulement (le Markdown des messages de Gladys est envoyé tel quel) ; un destinataire par action
  de scène.
- Les e-mails ne sont pas reçus : c’est un canal d’envoi seul.
- Les quotas d’envoi de votre forfait Mailjet s’appliquent en plus du plafond horaire.

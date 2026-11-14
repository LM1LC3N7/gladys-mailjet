# Mailjet pour Gladys

Intégration non officielle, sans lien avec Mailjet. Elle **envoie** des e-mails via votre compte Mailjet avec
l’API Send v3.1 ; elle n’en lit jamais. Cette intégration n’a jamais été testée avec un vrai compte Mailjet :
elle a été construite d’après la documentation officielle de Mailjet et testée sur de faux serveurs locaux.
Les retours sont les bienvenus.

## Ce qui part, et quand

Un e-mail ne part que par l’un de ces trois chemins :

1. **L’action de scène « Envoyer un e-mail avec Mailjet »** : un e-mail en texte brut à une adresse, avec un
   objet facultatif (sinon l’objet de la configuration). Sa sortie `message_id` est l’identifiant Mailjet de
   l’e-mail.
2. **Un message de Gladys, seulement si l’option « Envoyer aussi les messages de Gladys » est activée
   (désactivée par défaut)**, à un utilisateur qui a saisi son adresse dans le bloc **Mon compte**. Gladys
   relaie vers ce canal, entre autres : l’action de scène « Envoyer un message » du cœur, les messages
   système aux administrateurs (mise à jour, échec de sauvegarde, piles faibles, Gladys Plus, résumé
   hebdomadaire) et le **lien ou le code d’un mot de passe oublié**. L’intégration ne reçoit qu’une adresse
   et un texte : elle ne peut pas distinguer un message destiné à ce canal d’un message envoyé à tous les
   canaux, l’option les couvre donc tous, y compris quand Mailjet est le canal choisi pour les messages
   système. Chacun compte dans le plafond horaire et dans votre forfait Mailjet. Option désactivée, ces
   messages sont refusés et rien ne part ; le refus n’apparaît **que dans les journaux de Gladys** (ni dans
   la scène, ni dans le chat). L’image de caméra de l’action « Envoyer une image de caméra » est jointe
   (JPEG, PNG ou WebP, 2 Mo au plus).
3. **Le bouton Tester**, en **mode bac à sable** de Mailjet : Mailjet vérifie les clés et le message de test
   et ne distribue rien. Qu’il vérifie aussi l’expéditeur en bac à sable n’est pas confirmé : le premier
   vrai e-mail le dira. Le bouton appelle Mailjet à chaque clic, hors plafond horaire (borné par les 2
   requêtes à la fois et la pause). Il repose sur le drapeau `SandboxMode` de l’API Send, jamais vérifié sur
   un vrai compte : si Mailjet l’ignorait, l’e-mail de test serait vraiment distribué.

Rien n’est envoyé au démarrage ni à intervalle régulier.

## Mise en place

1. Dans Mailjet, **Paramètres du compte → API REST → Gestion des clés API** : copiez la clé d’API et la clé
   secrète.
2. **Expéditeurs et domaines** : validez l’adresse de l’expéditeur (ou tout son domaine). Sans cela, Mailjet
   refuse chaque e-mail (« pas l’adresse de l’expéditeur »).
3. Dans Gladys, saisissez les clés, l’adresse de l’expéditeur, au besoin le nom de l’expéditeur, l’objet des
   messages de Gladys, le plafond horaire et l’option « Envoyer aussi les messages de Gladys » ;
   enregistrez, puis cliquez sur **Tester**.
4. Si l’option est activée, chaque utilisateur saisit son adresse dans **Mon compte** (l’effacer pour
   arrêter).

La clé secrète est gardée par Gladys dans sa base, jamais réaffichée, et envoyée seulement à Mailjet.

## Ce qui protège votre compte et votre forfait

- **Plafond horaire** (20 par défaut, de 1 à 200) : au plus ce nombre d’e-mails sur 60 minutes glissantes,
  messages de Gladys et actions de scène ensemble. Au-delà, rien n’est envoyé et l’action échoue avec l’heure
  du prochain e-mail possible. Le compte est gardé dans `/data` aux redémarrages. Un e-mail est compté avant
  de partir. Il n’est décompté que si rien n’est parti : Mailjet a répondu un 4xx (400, 401, 403, 429), ou la
  connexion ne s’est jamais ouverte (connexion refusée, nom inconnu, réseau injoignable). Pas de réponse,
  une connexion coupée, un 5xx ou une réponse illisible le laissent compté.
- **Jamais envoyé deux fois** : l’intégration ne renvoie aucun e-mail, quoi qu’il arrive (pas de réponse,
  connexion coupée, erreur du serveur). Quand Mailjet n’a pas confirmé, l’action échoue avec « il a pu être
  envoyé, il n’est donc pas renvoyé ».
- **Messages de Gladys** : Gladys attend 5 secondes une réponse. Si Mailjet est plus lent, l’intégration
  répond au bout de 3,5 secondes « sans réponse pour l’instant » et laisse la requête se terminer (20
  secondes au plus) ; le statut dit ensuite comment cela s’est passé. Un e-mail qui attend encore son tour à
  ce moment-là est abandonné et ne part pas.
- **Au plus 2 e-mails à la fois**, 10 en attente ; au-delà, « trop d’e-mails à la fois » et rien n’est
  envoyé.
- **Ralentir** : après un 429 (trop de requêtes) ou une erreur du serveur Mailjet (5xx, même au corps
  illisible), rien n’est envoyé pendant 60 secondes, durée doublée à chaque nouvel échec jusqu’à 1 heure (un
  `Retry-After` de Mailjet est suivi jusqu’à 6 heures), Tester compris. La pause est gardée dans `/data` ; un
  e-mail accepté alors qu’elle commençait ne la lève pas.
- **Clés refusées** : seulement un 401 portant un code d’erreur de clé Mailjet (`mj-0001` clé suspendue,
  `mj-0015` identifiants erronés). Alors plus rien n’est envoyé avec ces clés tant qu’elles ne changent pas
  ou que le bouton Tester ne réussit pas (le bouton Tester essaie aussi des clés refusées, hors pause).
  Seuls 8 bits d’une empreinte salée sont gardés dans `/data`, jamais une clé. Pas un refus des clés : un
  401 sans un tel code (vide, page d’un proxy, réponse coupée : le prochain e-mail réessaie), un 403
  (expéditeur non validé, envoi refusé), une adresse ou un e-mail refusés (400).

## Statut

| Statut                                                                  | Sens                                                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Prêt                                                                    | Clés et expéditeur saisis ; vérifiés par Mailjet au premier e-mail ou avec le bouton Tester.          |
| Mailjet a accepté le dernier e-mail                                     | Avec le compte de la dernière heure et le plafond.                                                    |
| Mailjet a accepté les clés et le message de test                        | Le dernier test a réussi (rien n’a été distribué).                                                    |
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

import { Auth, normalizeEmail } from './auth';
import { resolveDataDir } from './config';
import { openDb } from './db';
import { HttpError } from './util';

/**
 * Secours quand l'administrateur a oublié son mot de passe : se lance sur la machine du serveur
 * (« Reinitialiser un mot de passe.bat »), crée un mot de passe provisoire et réactive le compte.
 */
export async function runResetPassword(args: string[]): Promise<number> {
  let email: string;
  try {
    email = normalizeEmail(args[0]);
  } catch (e) {
    console.error(e instanceof HttpError ? e.message : 'Adresse e-mail invalide.');
    return 2;
  }
  const db = openDb(resolveDataDir());
  const auth = new Auth(db);
  const user = auth.findByEmail(email);
  if (!user) {
    console.error('Aucun compte ne correspond à cette adresse.');
    const known = auth.listUsers().map((u) => `  - ${u.email}`);
    if (known.length) console.error('Comptes existants :\n' + known.join('\n'));
    return 1;
  }
  const password = Auth.tempPassword();
  await auth.setPassword(user.id, password, true);
  auth.revokeUserSessions(user.id);
  auth.updateUser(user.id, { disabled: false });
  console.log(`\nMot de passe provisoire de ${user.email} : ${password}`);
  console.log('À sa prochaine connexion, la personne devra choisir son propre mot de passe.');
  return 0;
}

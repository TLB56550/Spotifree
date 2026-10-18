// Point d'entrée unique. Trois modes :
//   (rien) ou « serve » : le serveur lui-même
//   « run »             : le serveur en arrière-plan, relancé après une mise à jour
//   « player »          : ouvre la fenêtre du lecteur (démarre le serveur au besoin)
const mode = process.argv[2];
if (mode === 'player') {
  const { runPlayer } = await import('./player');
  process.exit(await runPlayer(process.argv.slice(3)));
} else if (mode === 'run') {
  const { runSupervisor } = await import('./supervisor');
  process.exit(await runSupervisor());
} else {
  await import('./index');
}

export {};

'use client';
import { OnboardingChecklist } from '../../../components/onboarding-checklist';

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1>Bem-vindo ao OpenRate</h1>
        <p className="text-sm text-neutral-500">
          Siga os passos abaixo para deixar sua operação pronta: organização, loja, equipe,
          produtos e as primeiras ideias de vídeo geradas por IA.
        </p>
      </div>
      <OnboardingChecklist showWhenComplete />
    </div>
  );
}

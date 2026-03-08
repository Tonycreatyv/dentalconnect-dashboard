import { Stage } from "./playbook.ts";
import { Intent } from "./intents.ts";

export type ObjectionResponse = {
  replyText: string;
  stage: Stage;
  questionKey: string;
  flag: string;
};

export function handleObjection(intent: Intent, currentStage: Stage): ObjectionResponse | null {
  if (intent === "why_question") {
    return {
      replyText:
        "Te pregunto porque el sistema se adapta según tu negocio. Por ejemplo, para clínicas dentales puede responder pacientes automáticamente, agendar citas y enviar recordatorios. ¿Tu negocio es una clínica o algo diferente?",
      stage: currentStage,
      questionKey: "objection_why",
      flag: "why_question",
    };
  }
  if (intent === "confusion") {
    return {
      replyText:
        "Buena pregunta. Te explico: hacemos seguimiento automático, organizamos consultas y mantenemos la atención sin depender de que contestes todo manualmente.",
      stage: currentStage,
      questionKey: "objection_confusion",
      flag: "confusion",
    };
  }
  if (intent === "skepticism") {
    return {
      replyText:
        "Entiendo el escepticismo. Lo mejor es ver un ejemplo: respondemos pacientes, organizamos agenda y cuidamos que nadie se enfríe.",
      stage: currentStage,
      questionKey: "objection_skepticism",
      flag: "skepticism",
    };
  }
  if (intent === "curiosity") {
    return {
      replyText:
        "Qué bueno que preguntas, te cuento que capturamos cada consulta, organizamos la info y avisamos cuando hace falta seguirla.",
      stage: currentStage,
      questionKey: "objection_curiosity",
      flag: "curiosity",
    };
  }
  return null;
}

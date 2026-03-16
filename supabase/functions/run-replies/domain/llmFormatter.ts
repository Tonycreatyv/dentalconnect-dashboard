const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = "gpt-4o-mini";

export async function formatBotResponse(args: {
  templateResponse: string;
  patientName: string;
  clinicName: string;
  context: string;
}): Promise<string> {
  if (!OPENAI_API_KEY || args.templateResponse.length < 50) return args.templateResponse;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        max_tokens: 200,
        messages: [
          {
            role: "system",
            content: `Eres la recepcionista amigable de ${args.clinicName}, una clínica dental.
Reformula este mensaje para que suene natural y cálido, en español.
Mantén TODA la información exactamente igual.
No agregues información nueva.
Usa máximo 2-3 oraciones. Puedes usar emojis dentales 🦷😊 con moderación.
${args.patientName ? `El paciente se llama ${args.patientName}.` : ""}
Contexto: ${args.context}`,
          },
          { role: "user", content: args.templateResponse },
        ],
      }),
    });

    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content ?? "").trim() || args.templateResponse;
  } catch {
    return args.templateResponse;
  }
}

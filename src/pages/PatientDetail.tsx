import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useClinic } from "../context/ClinicContext";
import { SectionCard } from "../components/SectionCard";
import { EmptyState } from "../components/EmptyState";
import { formatDateTime } from "../lib/format";
import type { Appointment, ConversationMessage, Patient } from "../lib/types";

const PatientDetail = () => {
  const { patientId } = useParams();
  const { clinicId } = useClinic();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadPatient = async () => {
      if (!patientId) return;
      setLoading(true);

      const patientQuery = supabase
        .from("patients")
        .select("id, full_name, phone, created_at")
        .eq("id", patientId)
        .maybeSingle();

      if (clinicId) {
        patientQuery.eq("clinic_id", clinicId);
      }

      const { data: patientData } = await patientQuery;

      const patientPhone = patientData?.phone ?? null;
      const messagesQuery = supabase
        .from("conversation_messages")
        .select("patient_phone, role, message, channel, created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      const appointmentsQuery = supabase
        .from("appointments")
        .select("id, status, date, time, reason, channel_source, patient_id, patient_phone")
        .order("date", { ascending: false })
        .limit(50);

      if (clinicId) {
        messagesQuery.eq("clinic_id", clinicId);
        appointmentsQuery.eq("clinic_id", clinicId);
      }

      if (patientPhone) {
        messagesQuery.eq("patient_phone", patientPhone);
        appointmentsQuery.eq("patient_phone", patientPhone);
      } else {
        appointmentsQuery.eq("patient_id", patientId);
      }

      const [{ data: messagesData }, { data: appointmentsData }] = await Promise.all([
        messagesQuery,
        appointmentsQuery,
      ]);

      if (!mounted) return;
      setPatient(patientData ?? null);
      setMessages(messagesData ?? []);
      setAppointments(appointmentsData ?? []);
      setLoading(false);
    };

    loadPatient();

    return () => {
      mounted = false;
    };
  }, [clinicId, patientId]);

  if (!patientId) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">Patient profile</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-100">
            {patient?.full_name ?? "Unnamed patient"}
          </h2>
          <p className="mt-1 text-sm text-white/40">{patient?.phone ?? "No phone on file"}</p>
        </div>
        <Link to="/patients" className="text-sm text-teal-300 hover:text-teal-200">
          Back to patients
        </Link>
      </div>

      <SectionCard title="Conversation history" description="Read-only message timeline.">
        {loading ? (
          <p className="text-sm text-white/40">Loading messages...</p>
        ) : messages.length === 0 ? (
          <EmptyState
            title="No messages"
            message="This patient has no recorded conversation yet."
          />
        ) : (
          <div className="grid gap-3">
            {messages.map((message, index) => (
              <div
                key={`${message.patient_phone ?? "patient"}-${index}`}
                className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      {message.role ?? "patient"}
                    </p>
                    <p className="text-xs text-white/50">{message.channel ?? "unknown"}</p>
                  </div>
                  <p className="text-xs text-white/50">{formatDateTime(message.created_at)}</p>
                </div>
                <p className="mt-2 text-sm text-slate-300">{message.message ?? "(no content)"}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Appointments" description="Requests and scheduled visits.">
        {loading ? (
          <p className="text-sm text-white/40">Loading appointments...</p>
        ) : appointments.length === 0 ? (
          <EmptyState title="No appointments" message="No appointments linked to this patient." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950/60 text-xs uppercase tracking-[0.2em] text-white/50">
                <tr>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                  <th className="px-4 py-3 text-left">Channel</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {appointments.map((appointment) => (
                  <tr key={appointment.id} className="bg-slate-950/30 text-slate-300">
                    <td className="px-4 py-3">{appointment.status ?? "requested"}</td>
                    <td className="px-4 py-3">
                      {appointment.date ?? "--"} {appointment.time ?? ""}
                    </td>
                    <td className="px-4 py-3">{appointment.reason ?? "--"}</td>
                    <td className="px-4 py-3">{appointment.channel_source ?? "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default PatientDetail;

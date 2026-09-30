'use client';

import { useParams } from 'next/navigation';
import { EventDetailScreen } from '../../../_components/event-detail';

export default function ClosingEventPage() {
  const { eventId } = useParams<{ eventId: string }>();
  return <EventDetailScreen kind="closing" eventId={eventId} />;
}

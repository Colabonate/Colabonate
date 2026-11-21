# Notification Drawer

Ein seitlicher Drawer zur Anzeige und Verwaltung von Benachrichtigungen.

## Zweck

Der Notification Drawer bietet eine vollständige Übersicht über alle Benachrichtigungen in der Anwendung. Er wird typischerweise durch Klicken auf ein Notification-Icon in der Navbar geöffnet und schiebt sich von rechts in die App ein.

## Verwendung

```tsx
import { NotificationDrawer } from '@ds/ui';

function MyComponent() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  
  const handleMarkAsRead = (id: string) => {
    // Mark notification as read logic
  };
  
  const handleMarkAllAsRead = () => {
    // Mark all notifications as read logic
  };

  return (
    <>
      <IconButton onClick={() => setDrawerOpen(true)}>
        <Bell />
        {unreadCount > 0 && <Badge badgeContent={unreadCount} />}
      </IconButton>
      
      <NotificationDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        notifications={notifications}
        onMarkAsRead={handleMarkAsRead}
        onMarkAllAsRead={handleMarkAllAsRead}
      />
    </>
  );
}
```

## Props

| Prop | Typ | Erforderlich | Standardwert | Beschreibung |
|------|-----|-------------|--------------|-------------|
| `open` | `boolean` | Ja | - | Steuert, ob der Drawer geöffnet oder geschlossen ist |
| `onClose` | `() => void` | Ja | - | Callback, der aufgerufen wird, wenn der Drawer geschlossen werden soll |
| `notifications` | `Notification[]` | Ja | - | Array von Benachrichtigungen zum Anzeigen |
| `onMarkAsRead` | `(id: string) => void` | Nein | - | Callback, der aufgerufen wird, wenn eine Benachrichtigung als gelesen markiert wird |
| `onMarkAllAsRead` | `() => void` | Nein | - | Callback, der aufgerufen wird, wenn alle Benachrichtigungen als gelesen markiert werden |
| `width` | `number \| string` | Nein | `400` | Breite des Drawers (Desktop), Mobile ist immer 100% |
| `title` | `string` | Nein | `'Benachrichtigungen'` | Titel im Header des Drawers |
| `drawerProps` | `Partial<DrawerProps>` | Nein | - | Zusätzliche Props für die zugrunde liegende MUI Drawer-Komponente |

### Notification Interface

```ts
interface Notification {
  id: string;
  type: 'ticket' | 'message' | 'system' | 'offer';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  relatedId?: string;
  actionUrl?: string;
}
```

## Tokens

Die Komponente verwendet folgende Design-Tokens:

- `--theme-scrolled-bg`: Hintergrundfarbe des Drawer-Panels (gleicher Blue-Glass-Effekt wie das gescrollte Mobile Main Menu)
- `--theme-shadow`: Schlagschatten des Panels
- `--theme-bg-elevated`: Hintergrund für ungelesene Notification-Karten
- `--theme-text`: Textfarbe
- `--theme-text-muted`: Sekundäre Textfarbe
- `--theme-border`: Rahmenfarbe (inkl. Inset-Ring am Panel-Rand)
- `--theme-border-subtle`: Subtile Rahmenfarbe für Listenelemente
- `--theme-bg-subtle`: Subtiler Hintergrund für Header und Filter-Leiste
- `--theme-bg-hover`: Hover-Hintergrund für interaktive Elemente
- `--color-primary-50`: Primärfarbe für ungelesene Benachrichtigungen
- `--color-secondary-5`: Leichter Hintergrund für ungelesene Benachrichtigungen
- `--color-secondary-10`: Hintergrund für "Alle lesen" Button
- `--color-secondary-70`: Textfarbe für "Alle lesen" Button
- `--color-secondary-20`: Hover-Hintergrund für "Alle lesen" Button

## Do's and Don'ts

### Do's
- Verwenden Sie die Komponente für eine konsistente Benachrichtigungsübersicht
- Integrieren Sie sie mit dem globalen Notification Context
- Stellen Sie sicher, dass Benachrichtigungen persistiert werden (z.B. im localStorage)
- Nutzen Sie die `actionUrl`-Eigenschaft für klickbare Benachrichtigungen

### Don'ts
- Hardcodieren Sie keine CSS-Werte - verwenden Sie nur Token-Referenzen
- Fügen Sie keine Logik oder State-Management in die Komponente ein (headless-first Prinzip)
- Überschreiten Sie nicht die maximale Anzahl von Benachrichtigungen (empfohlen: max. 50)
- Verwenden Sie keine externen Abhängigkeiten außerhalb des Design-Systems

## Responsivität

- **Mobile (xs)**: Drawer nimmt 100% der Bildschirmbreite ein
- **Desktop (sm+)**: Drawer hat eine feste Breite von 400px (konfigurierbar)

Die Komponente folgt den Breakpoints des Design-Systems: sm=360, md=600, lg=900, xl=1200.
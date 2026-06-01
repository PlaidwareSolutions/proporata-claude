import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { MapLayersProvider } from "@/contexts/MapLayersContext";
import Home from "@/pages/Home";
import SiteMap from "@/pages/SiteMap";
import Overview from "@/pages/Overview";
import Buildings from "@/pages/Buildings";
import BuildingDetail from "@/pages/BuildingDetail";
import Units from "@/pages/Units";
import MembersPage from "@/pages/Members";
import UnitDetail from "@/pages/UnitDetail";
import WorkOrders from "@/pages/WorkOrders";
import WorkOrderDetail from "@/pages/WorkOrderDetail";
import CreateWorkOrder from "@/pages/CreateWorkOrder";
import Insurance from "@/pages/Insurance";
import Documents from "@/pages/Documents";
import Reports from "@/pages/Reports";
import Budgets from "@/pages/Budgets";
import AmenityFinancials from "@/pages/AmenityFinancials";
import Settings from "@/pages/Settings";
import Boards from "@/pages/Boards";
import Communications from "@/pages/Communications";
import Announcements from "@/pages/Announcements";
import Login from "@/pages/Login";
import AcceptInvite from "@/pages/AcceptInvite";
import ResidentPortal from "@/pages/ResidentPortal";
import ResidentHearingDetail from "@/pages/ResidentHearingDetail";
import ResidentDocuments from "@/pages/ResidentDocuments";
import ResidentProfile from "@/pages/ResidentProfile";
import VerifyEmail from "@/pages/VerifyEmail";
import ArchitecturalRequests from "@/pages/ArchitecturalRequests";
import ArchitecturalRequestDetail from "@/pages/ArchitecturalRequestDetail";
import ResidentArchitectural from "@/pages/ResidentArchitectural";
import MyAccount from "@/pages/MyAccount";
import Billing from "@/pages/Billing";
import Payments from "@/pages/Payments";
import Vendors from "@/pages/Vendors";
import VendorDetail from "@/pages/VendorDetail";
import Bids from "@/pages/Bids";
import BidDetail from "@/pages/BidDetail";
import Motions from "@/pages/Motions";
import Resolutions from "@/pages/Resolutions";
import ResidentResolutions from "@/pages/ResidentResolutions";
import ResidentBoard from "@/pages/ResidentBoard";
import ResidentAmenities from "@/pages/ResidentAmenities";
import MyPets from "@/pages/MyPets";
import PetsAdmin from "@/pages/PetsAdmin";
import Amenities from "@/pages/Amenities";
import MailRoom from "@/pages/MailRoom";
import MailRoomKiosk from "@/pages/MailRoomKiosk";
import ResidentMail from "@/pages/ResidentMail";
import EvCharging from "@/pages/EvCharging";
import Patrol from "@/pages/Patrol";
import ParkingPermits from "@/pages/ParkingPermits";
import FobInventory from "@/pages/FobInventory";
import PoolTagsAdmin from "@/pages/PoolTagsAdmin";
import CalendarPage from "@/pages/Calendar";
import Meetings from "@/pages/Meetings";
import MeetingDetail from "@/pages/MeetingDetail";
import QuoteSubmit from "@/pages/QuoteSubmit";
import HelpGlossary from "@/pages/HelpGlossary";
import Operations from "@/pages/Operations";
import FinancialsPage from "@/pages/Financials";
import CompliancePage from "@/pages/Compliance";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect to="/login" />;
  // Manager/admin-only pages: residents are bounced to the shared role-aware
  // home at "/", which has its own resident dashboards.
  if (user.role === "resident") return <Redirect to="/" />;
  return <Component />;
}

// Admins/managers always; residents only when flagged as board members so
// they can vote on Stripe key changes. boardMember is refreshed from the DB
// by /auth/me so admin-side flag changes take effect without re-login.
function SettingsRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect to="/login" />;
  if (user.role === "resident" && !user.boardMember) return <Redirect to="/" />;
  return <Component />;
}

function AnyAuthRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect to="/login" />;
  return <Component />;
}

function ResidentRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect to="/login" />;
  if (user.role !== "resident") return <Redirect to="/" />;
  return <Component />;
}

function ProfileRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect to="/login" />;
  return <Component />;
}

function PublicOnlyRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) {
    return <Redirect to="/" />;
  }
  return <Component />;
}

export function Router() {
  return (
    <Switch>
      <Route path="/login">
        <PublicOnlyRoute component={Login} />
      </Route>
      <Route path="/accept-invite/:token">
        <PublicOnlyRoute component={AcceptInvite} />
      </Route>
      <Route path="/portal">
        <Redirect to="/" />
      </Route>
      <Route path="/portal/documents">
        <ResidentRoute component={ResidentDocuments} />
      </Route>
      <Route path="/profile">
        <ProfileRoute component={ResidentProfile} />
      </Route>
      <Route path="/verify-email">
        <VerifyEmail />
      </Route>
      <Route path="/portal/architectural">
        <ResidentRoute component={ResidentArchitectural} />
      </Route>
      <Route path="/portal/architectural/:id">
        <ResidentRoute component={ArchitecturalRequestDetail} />
      </Route>
      <Route path="/portal/account">
        <ResidentRoute component={MyAccount} />
      </Route>
      <Route path="/portal/hearings/:id">
        <ResidentRoute component={ResidentHearingDetail} />
      </Route>
      <Route path="/">
        <AnyAuthRoute component={Home} />
      </Route>
      <Route path="/site-map">
        <ProtectedRoute component={SiteMap} />
      </Route>
      <Route path="/overview">
        <ProtectedRoute component={Overview} />
      </Route>
      <Route path="/buildings">
        <ProtectedRoute component={Buildings} />
      </Route>
      <Route path="/buildings/:id">
        <ProtectedRoute component={BuildingDetail} />
      </Route>
      <Route path="/units">
        <ProtectedRoute component={Units} />
      </Route>
      <Route path="/members">
        <ProtectedRoute component={MembersPage} />
      </Route>
      <Route path="/units/:id">
        <ProtectedRoute component={UnitDetail} />
      </Route>
      <Route path="/work-orders/new">
        <ProtectedRoute component={CreateWorkOrder} />
      </Route>
      <Route path="/work-orders/:id">
        <AnyAuthRoute component={WorkOrderDetail} />
      </Route>
      <Route path="/work-orders">
        <ProtectedRoute component={WorkOrders} />
      </Route>
      <Route path="/insurance">
        <ProtectedRoute component={Insurance} />
      </Route>
      <Route path="/documents">
        <ProtectedRoute component={Documents} />
      </Route>
      <Route path="/reports">
        <ProtectedRoute component={Reports} />
      </Route>
      <Route path="/reports/amenities">
        <ProtectedRoute component={AmenityFinancials} />
      </Route>
      <Route path="/budgets">
        <SettingsRoute component={Budgets} />
      </Route>
      <Route path="/settings">
        <SettingsRoute component={Settings} />
      </Route>
      <Route path="/boards">
        <ProtectedRoute component={Boards} />
      </Route>
      <Route path="/communications">
        <ProtectedRoute component={Communications} />
      </Route>
      <Route path="/announcements">
        <AnyAuthRoute component={Announcements} />
      </Route>
      <Route path="/architectural-requests/:id">
        <ProtectedRoute component={ArchitecturalRequestDetail} />
      </Route>
      <Route path="/architectural-requests">
        <ProtectedRoute component={ArchitecturalRequests} />
      </Route>
      <Route path="/billing">
        <ProtectedRoute component={Billing} />
      </Route>
      <Route path="/billing/payments">
        <ProtectedRoute component={Payments} />
      </Route>
      <Route path="/vendors/:id">
        <ProtectedRoute component={VendorDetail} />
      </Route>
      <Route path="/vendors">
        <ProtectedRoute component={Vendors} />
      </Route>
      <Route path="/bids/:id">
        <ProtectedRoute component={BidDetail} />
      </Route>
      <Route path="/bids">
        <ProtectedRoute component={Bids} />
      </Route>
      <Route path="/motions">
        <AnyAuthRoute component={Motions} />
      </Route>
      <Route path="/resolutions">
        <SettingsRoute component={Resolutions} />
      </Route>
      <Route path="/portal/resolutions">
        <ResidentRoute component={ResidentResolutions} />
      </Route>
      <Route path="/portal/board">
        <ResidentRoute component={ResidentBoard} />
      </Route>
      <Route path="/portal/amenities">
        <ResidentRoute component={ResidentAmenities} />
      </Route>
      <Route path="/portal/pets">
        <ResidentRoute component={MyPets} />
      </Route>
      <Route path="/pets">
        <ProtectedRoute component={PetsAdmin} />
      </Route>
      <Route path="/amenities">
        <ProtectedRoute component={Amenities} />
      </Route>
      <Route path="/mail-room">
        <ProtectedRoute component={MailRoom} />
      </Route>
      <Route path="/mailroom/kiosk">
        <AnyAuthRoute component={MailRoomKiosk} />
      </Route>
      <Route path="/portal/mail">
        <ResidentRoute component={ResidentMail} />
      </Route>
      <Route path="/ev-charging">
        <AnyAuthRoute component={EvCharging} />
      </Route>
      <Route path="/portal/ev-charging">
        <ResidentRoute component={EvCharging} />
      </Route>
      <Route path="/patrol">
        <ProtectedRoute component={Patrol} />
      </Route>
      <Route path="/parking">
        <ProtectedRoute component={ParkingPermits} />
      </Route>
      <Route path="/portal/parking">
        <ResidentRoute component={ParkingPermits} />
      </Route>
      <Route path="/fobs">
        <ProtectedRoute component={FobInventory} />
      </Route>
      <Route path="/pool-tags">
        <ProtectedRoute component={PoolTagsAdmin} />
      </Route>
      <Route path="/calendar">
        <AnyAuthRoute component={CalendarPage} />
      </Route>
      <Route path="/operations">
        <ProtectedRoute component={Operations} />
      </Route>
      <Route path="/meetings/:id">
        <AnyAuthRoute component={MeetingDetail} />
      </Route>
      <Route path="/meetings">
        <AnyAuthRoute component={Meetings} />
      </Route>
      <Route path="/quote/:token">
        <QuoteSubmit />
      </Route>
      <Route path="/help/glossary/:key">
        <AnyAuthRoute component={HelpGlossary} />
      </Route>
      <Route path="/help">
        <AnyAuthRoute component={HelpGlossary} />
      </Route>
      <Route path="/financials">
        <ProtectedRoute component={FinancialsPage} />
      </Route>
      <Route path="/compliance">
        <ProtectedRoute component={CompliancePage} />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <MapLayersProvider>
            <Router />
          </MapLayersProvider>
        </AuthProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;

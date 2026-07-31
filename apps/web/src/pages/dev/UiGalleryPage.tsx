/**
 * Dev-only "kitchen sink" gallery — renders every UI primitive in its variants
 * and states so the design system is reviewable at a glance in both themes.
 * Not linked from production nav.
 */
import { Bell, Mail, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  HoverLift,
  Reveal,
  Stagger,
  StaggerItem,
} from "../../components/motion/index.js";
import { useCountUp } from "../../lib/motion.js";
import { BraceMotif } from "../../components/brand/BraceMotif.js";
import { Brandmark } from "../../components/brand/Brandmark.js";
import { Logo } from "../../components/brand/Logo.js";
import { ThemeToggle } from "../../components/ThemeToggle.js";
import { Container } from "../../components/layout/Container.js";
import { Section } from "../../components/layout/Section.js";
import {
  Alert,
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  IconButton,
  Input,
  Label,
  Pagination,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useToast,
  type SortDirection,
  type ToastVariant,
} from "../../components/ui/index.js";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {children}
      </CardContent>
    </Card>
  );
}

const PRIMARY_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const primaryBg: Record<number, string> = {
  50: "bg-primary-50",
  100: "bg-primary-100",
  200: "bg-primary-200",
  300: "bg-primary-300",
  400: "bg-primary-400",
  500: "bg-primary-500",
  600: "bg-primary-600",
  700: "bg-primary-700",
  800: "bg-primary-800",
  900: "bg-primary-900",
  950: "bg-primary-950",
};

function Counter({
  target,
  label,
  format,
}: {
  target: number;
  label: string;
  format?: (n: number) => string;
}) {
  const value = useCountUp(target, { duration: 1.4, format });
  return (
    <div className="text-center">
      <div className="font-mono text-3xl font-bold text-primary">{value}</div>
      <div className="mt-1 text-xs text-ink-muted">{label}</div>
    </div>
  );
}

const STAGGER_ITEMS = ["Aptitude", "DSA", "Verbal", "Reasoning", "SQL", "OS"];

function MotionSection() {
  // Bumping this key remounts the entrance demos so they replay on demand
  // (Reveal/Stagger/useCountUp intentionally play once per mount).
  const [replayKey, setReplayKey] = useState(0);

  const demoLabel =
    "text-xs font-semibold uppercase tracking-wide text-ink-muted";
  const demoCard =
    "rounded-xl border border-subtle bg-surface-raised p-4 text-sm text-ink-secondary";

  return (
    <Section
      braced
      title="Motion"
      description="Reduced-motion-aware primitives built on framer-motion + our duration/easing tokens. With prefers-reduced-motion ON, every item is static and immediately visible."
    >
      <div className="w-full space-y-8">
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReplayKey((k) => k + 1)}
          >
            <RotateCcw className="h-4 w-4" /> Replay entrance
          </Button>
        </div>

        <div key={replayKey} className="space-y-8">
          {/* Reveal */}
          <div className="space-y-3">
            <p className={demoLabel}>Reveal — on-mount, once</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Reveal variant="fadeInUp">
                <div className={demoCard}>fadeInUp</div>
              </Reveal>
              <Reveal variant="fadeIn" delay={0.1}>
                <div className={demoCard}>fadeIn · delay 0.1s</div>
              </Reveal>
              <Reveal variant="scaleIn" delay={0.2}>
                <div className={demoCard}>scaleIn · delay 0.2s</div>
              </Reveal>
            </div>
          </div>

          {/* Stagger */}
          <div className="space-y-3">
            <p className={demoLabel}>Stagger — children cascade in</p>
            <Stagger className="flex flex-wrap gap-2">
              {STAGGER_ITEMS.map((item) => (
                <StaggerItem key={item}>
                  <Badge variant="primary">{item}</Badge>
                </StaggerItem>
              ))}
            </Stagger>
          </div>

          {/* useCountUp */}
          <div className="space-y-3">
            <p className={demoLabel}>useCountUp — 0 → target on mount</p>
            <div className="flex flex-wrap gap-10">
              <Counter target={98} label="Best score" />
              <Counter target={12480} label="Learners" />
              <Counter
                target={4.8}
                label="Avg rating"
                format={(n) => n.toFixed(1)}
              />
            </div>
          </div>
        </div>

        {/* HoverLift (hover affordance; not part of the entrance replay) */}
        <div className="space-y-3">
          <p className={demoLabel}>
            HoverLift — hover to lift + glow (static on touch / reduced motion)
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              "Lifts on hover",
              "Gains shadow-glow",
              "No-op on touch/reduced",
            ].map((t) => (
              <HoverLift key={t}>
                <Card className="p-5 text-sm text-ink-secondary">{t}</Card>
              </HoverLift>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

export function UiGalleryPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(3);
  const [sort, setSort] = useState<SortDirection>("asc");
  const [progress, setProgress] = useState(64);

  const fireToast = (variant: ToastVariant) =>
    toast({
      variant,
      title: `${variant[0]?.toUpperCase()}${variant.slice(1)} toast`,
      description: "This is an imperative toast notification.",
    });

  return (
    <div className="min-h-screen bg-surface py-10">
      <Container size="lg" className="space-y-10">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo className="h-8" />
            <Badge variant="outline">/dev/ui</Badge>
          </div>
          <ThemeToggle />
        </header>

        <Section
          braced
          title="Brand"
          description="Wordmark, brandmark, and the recurring brace motif."
        >
          <div className="flex flex-wrap items-center gap-8">
            <Logo className="h-10" />
            <Brandmark className="h-10 w-10" />
            <BraceMotif>code aptitude</BraceMotif>
          </div>
        </Section>

        <Section
          braced
          title="Primary scale"
          description="CodeApt Cyan, 50 → 950."
        >
          <div className="flex flex-wrap gap-2">
            {PRIMARY_STEPS.map((step) => (
              <div key={step} className="text-center">
                <div
                  className={`h-14 w-14 rounded-lg border border-subtle ${primaryBg[step]}`}
                />
                <span className="mt-1 block font-mono text-xs text-ink-muted">
                  {step}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section braced title="Typography">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight text-ink">
              Display heading
            </h1>
            <h2 className="text-2xl font-semibold text-ink">Section heading</h2>
            <p className="text-ink-secondary">
              Body text in Inter. The quick brown fox jumps over the lazy dog.
            </p>
            <p className="text-sm text-ink-muted">Muted secondary text.</p>
            <p className="font-mono text-sm text-primary">
              {"const score = 98; // JetBrains Mono"}
            </p>
          </div>
        </Section>

        <Section braced title="Buttons">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button loading>Loading</Button>
              <Button disabled>Disabled</Button>
              <Button>
                <Plus className="h-4 w-4" /> With icon
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <IconButton
                aria-label="Search"
                icon={<Search className="h-5 w-5" />}
              />
              <IconButton
                aria-label="Add"
                variant="primary"
                icon={<Plus className="h-5 w-5" />}
              />
              <IconButton
                aria-label="Delete"
                variant="outline"
                icon={<Trash2 className="h-5 w-5" />}
              />
            </div>
          </div>
        </Section>

        <Section braced title="Form controls">
          <div className="grid w-full gap-6 md:grid-cols-2">
            <FormField label="Email" hint="We never share it." required>
              <Input placeholder="you@example.com" leading={<Mail />} />
            </FormField>
            <FormField label="Invalid field" error="This field is required">
              <Input placeholder="Oops" defaultValue="bad value" />
            </FormField>
            <FormField label="Bio" className="md:col-span-2">
              <Textarea placeholder="Tell us about yourself" />
            </FormField>
            <FormField label="Track">
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a track" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="service">Service-based</SelectItem>
                  <SelectItem value="product">Product-based</SelectItem>
                  <SelectItem value="tcs">TCS NQT</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox id="c1" defaultChecked />
                <Label htmlFor="c1">Accept terms</Label>
              </div>
              <RadioGroup defaultValue="a" className="flex gap-4">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="a" id="r1" />
                  <Label htmlFor="r1">Option A</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="b" id="r2" />
                  <Label htmlFor="r2">Option B</Label>
                </div>
              </RadioGroup>
              <div className="flex items-center gap-2">
                <Switch id="s1" defaultChecked />
                <Label htmlFor="s1">Enable notifications</Label>
              </div>
            </div>
          </div>
        </Section>

        <Section braced title="Badges & Alerts">
          <div className="w-full space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="primary">Primary</Badge>
              <Badge variant="neutral">Neutral</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="error">Error</Badge>
              <Badge variant="info">Info</Badge>
              <Badge variant="outline">Outline</Badge>
            </div>
            <Alert variant="info" title="Heads up">
              This is an informational callout.
            </Alert>
            <Alert variant="success" title="Success">
              Your changes were saved.
            </Alert>
            <Alert variant="warning" title="Careful">
              This action needs your attention.
            </Alert>
            <Alert variant="error" title="Error">
              Something went wrong.
            </Alert>
          </div>
        </Section>

        <Block title="Feedback: Spinner, Skeleton, Progress, Toast">
          <Spinner />
          <div className="w-40 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="w-48 space-y-2">
            <Progress value={progress} />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setProgress((p) => (p + 15) % 105)}
            >
              Advance
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                "default",
                "success",
                "error",
                "warning",
                "info",
              ] as ToastVariant[]
            ).map((v) => (
              <Button
                key={v}
                size="sm"
                variant="outline"
                onClick={() => fireToast(v)}
              >
                <Bell className="h-4 w-4" /> {v}
              </Button>
            ))}
          </div>
        </Block>

        <Block title="Overlays: Dialog, Sheet, Dropdown, Tooltip">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm action</DialogTitle>
                <DialogDescription>
                  This is an accessible modal dialog built on Radix.
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-ink-secondary">
                Focus is trapped and Escape closes it.
              </p>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button>Confirm</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary">Open sheet</Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Side sheet</SheetTitle>
                <SheetDescription>A slide-in drawer panel.</SheetDescription>
              </SheetHeader>
              <p className="text-sm text-ink-secondary">
                Sheet content goes here.
              </p>
            </SheetContent>
          </Sheet>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Open menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <Plus /> New item
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Search /> Search
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost">Hover me</Button>
            </TooltipTrigger>
            <TooltipContent>A helpful tooltip</TooltipContent>
          </Tooltip>
        </Block>

        <Section braced title="Tabs">
          <Tabs defaultValue="overview" className="w-full">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <p className="text-sm text-ink-secondary">
                Overview panel content.
              </p>
            </TabsContent>
            <TabsContent value="details">
              <p className="text-sm text-ink-secondary">
                Details panel content.
              </p>
            </TabsContent>
            <TabsContent value="activity">
              <p className="text-sm text-ink-secondary">
                Activity panel content.
              </p>
            </TabsContent>
          </Tabs>
        </Section>

        <Section braced title="Table & Pagination">
          <div className="w-full space-y-4">
            <Breadcrumb
              items={[
                { label: "Home", href: "/app" },
                { label: "Users", href: "/app" },
                { label: "Detail" },
              ]}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    sortable
                    sortDirection={sort}
                    onSort={() => setSort(sort === "asc" ? "desc" : "asc")}
                  >
                    Name
                  </TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  { name: "Ada Lovelace", role: "Student", score: 98 },
                  { name: "Alan Turing", role: "Student", score: 95 },
                  { name: "Grace Hopper", role: "Admin", score: 99 },
                ].map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <Avatar size="sm" name={r.name} />
                        {r.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={r.role === "Admin" ? "primary" : "neutral"}
                      >
                        {r.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono">{r.score}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination page={page} totalPages={12} onPageChange={setPage} />
          </div>
        </Section>

        <Section braced title="Empty state & Cards">
          <div className="grid w-full gap-4 md:grid-cols-2">
            <EmptyState
              title="No results found"
              description="Try adjusting your filters or search terms."
              action={<Button size="sm">Clear filters</Button>}
            />
            <Card>
              <CardHeader>
                <CardTitle>Card title</CardTitle>
                <CardDescription>Card description text.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-ink-secondary">
                  Cards group related content on a raised surface.
                </p>
              </CardContent>
              <CardFooter>
                <Button size="sm">Action</Button>
                <Button size="sm" variant="ghost">
                  Cancel
                </Button>
              </CardFooter>
            </Card>
          </div>
        </Section>

        <MotionSection />
      </Container>
    </div>
  );
}

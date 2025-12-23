import { useState, useEffect } from "react";
import { Layout } from "@/components/shared/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, Loader2, Users, Building2, Home, Shield, UserCog, User,
  Search, Filter, Trash2, ShieldAlert, MoreVertical, FileText, Upload, CheckCircle, AlertCircle 
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { storage } from "@/lib/storage";

export default function AdminManagement() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("users");
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [addBlockOpen, setAddBlockOpen] = useState(false);
  const [addFlatOpen, setAddFlatOpen] = useState(false);
  
  // New state for Role Selection
  const [selectedRole, setSelectedRole] = useState(null);
  const [residentCreationMode, setResidentCreationMode] = useState(null);
  
  // Reset mode when role changes
  useEffect(() => {
    if (!selectedRole) setResidentCreationMode(null);
  }, [selectedRole]);

  // Reset role when dialog closes
  useEffect(() => {
    if (!addUserOpen) {
      setTimeout(() => setSelectedRole(null), 300); // Delay reset to avoid UI flicker
    }
  }, [addUserOpen]);

  // Real-time users subscription
  useEffect(() => {
    const unsubscribe = storage.subscribeToUsers((data) => {
      queryClient.setQueryData(["/api/admin/users"], data);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const { data: blocks = [] } = useQuery({
    queryKey: ["/api/blocks"],
    queryFn: async () => {
      return await storage.getBlocks();
    },
  });

  // Changed from residents to all users
  const { data: users = [], refetch: refetchUsers } = useQuery({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      return await storage.getAllUsersWithDetails();
    },
    staleTime: Infinity
  });

  const { data: flats = {}, refetch: refetchFlats } = useQuery({
    queryKey: ["/api/blocks/flats"],
    queryFn: async () => {
      const flatsByBlock = {};
      for (const block of blocks) {
        const blockFlats = await storage.getFlatsByBlock(block.id);
        flatsByBlock[block.id] = blockFlats;
      }
      return flatsByBlock;
    },
    enabled: blocks.length > 0,
  });

  const addResidentMutation = useMutation({
    mutationFn: async (data) => {
      return await storage.createResident(data);
    },
    onSuccess: () => {
      toast({ title: "Resident added successfully" });
      refetchUsers();
      setAddUserOpen(false);
    },
    onError: (err) => {
      toast({ title: "Failed to add resident", description: err.message, variant: "destructive" });
    },
  });

  const addSystemUserMutation = useMutation({
    mutationFn: async (data) => {
      return await storage.createSystemUser(data);
    },
    onSuccess: (_, variables) => {
      toast({ title: `${variables.role === 'admin' ? 'Admin' : 'Guard'} added successfully` });
      refetchUsers();
      setAddUserOpen(false);
    },
    onError: (err) => {
      toast({ title: "Failed to add user", description: err.message, variant: "destructive" });
    },
  });

  const addBlockMutation = useMutation({
    mutationFn: async (data) => {
      return await storage.createBlocks(parseInt(data.count, 10));
    },
    onSuccess: () => {
      toast({ title: "Blocks created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/blocks"] });
      setAddBlockOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to add block", variant: "destructive" });
    },
  });

  const addFlatMutation = useMutation({
    mutationFn: async (data) => {
      return await storage.createFlatsBulk(data.blockId, data.floors, data.flatsPerFloor);
    },
    onSuccess: (data) => {
      toast({ title: `Successfully processed ${data.count} flats` });
      refetchFlats();
      setAddFlatOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to add flats", variant: "destructive" });
    },
  });

  // Sorting Logic: Admin (1) > Guard (2) > Resident (3)
  const sortedUsers = [...users].sort((a, b) => {
    const rolePriority = { admin: 1, guard: 2, resident: 3 };
    return (rolePriority[a.role] || 99) - (rolePriority[b.role] || 99);
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Society Management</h1>
          <p className="text-slate-500 mt-1">Manage blocks, flats, and user accounts</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="users">
              <Users className="w-4 h-4 mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="blocks">
              <Building2 className="w-4 h-4 mr-2" />
              Blocks
            </TabsTrigger>
            <TabsTrigger value="flats">
              <Home className="w-4 h-4 mr-2" />
              Flats
            </TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>User Management</CardTitle>
                  <p className="text-sm text-slate-500 mt-1">Add and manage users (Admins, Guards, Residents)</p>
                </div>
                <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-add-resident">
                      <Plus className="w-4 h-4 mr-2" />
                      Add User
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>
                        {!selectedRole ? "Select Role" : `Add New ${selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1)}`}
                      </DialogTitle>
                      <DialogDescription>
                        {!selectedRole 
                          ? "Choose the type of user account you want to create."
                          : "Fill in the details below to create the account."}
                      </DialogDescription>
                    </DialogHeader>

                    {!selectedRole ? (
                      <div className="grid grid-cols-1 gap-4 py-4">
                        {/* Admin creation removed to enforce single-admin per residency model for now */}
                        
                        <Button 
                          variant="outline" 
                          className="h-auto p-4 flex justify-start gap-4 hover:border-primary hover:bg-primary/5"
                          onClick={() => setSelectedRole("guard")}
                        >
                          <div className="p-2 bg-slate-100 rounded-full">
                            <UserCog className="h-6 w-6 text-slate-600" />
                          </div>
                          <div className="text-left">
                            <div className="font-semibold text-slate-900">Guard</div>
                            <div className="text-sm text-slate-500">Gate entry and exit verification</div>
                          </div>
                        </Button>

                        <Button 
                          variant="outline" 
                          className="h-auto p-4 flex justify-start gap-4 hover:border-primary hover:bg-primary/5"
                          onClick={() => setSelectedRole("resident")}
                        >
                          <div className="p-2 bg-slate-100 rounded-full">
                            <User className="h-6 w-6 text-slate-600" />
                          </div>
                          <div className="text-left">
                            <div className="font-semibold text-slate-900">Resident</div>
                            <div className="text-sm text-slate-500">Flat owner/tenant with approval access</div>
                          </div>
                        </Button>
                        
                        <div className="flex justify-end pt-2">
                           <Button variant="ghost" onClick={() => setAddUserOpen(false)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {selectedRole === "resident" ? (
                          !residentCreationMode ? (
                             <div className="grid grid-cols-1 gap-4 py-4">
                               <Button variant="outline" className="h-auto p-4 flex justify-start gap-4 hover:bg-slate-50" onClick={() => setResidentCreationMode('manual')}>
                                 <div className="p-2 bg-blue-100 rounded-full">
                                    <User className="h-6 w-6 text-blue-600" />
                                 </div>
                                 <div className="text-left">
                                    <div className="font-semibold text-slate-900">Add Single Resident</div>
                                    <div className="text-sm text-slate-500">Fill form manually</div>
                                 </div>
                               </Button>
                               <Button variant="outline" className="h-auto p-4 flex justify-start gap-4 hover:bg-slate-50" onClick={() => setResidentCreationMode('bulk')}>
                                 <div className="p-2 bg-orange-100 rounded-full">
                                    <FileText className="h-6 w-6 text-orange-600" />
                                 </div>
                                 <div className="text-left">
                                    <div className="font-semibold text-slate-900">Upload Resident PDF</div>
                                    <div className="text-sm text-slate-500">Bulk create from file</div>
                                 </div>
                               </Button>
                               <div className="flex justify-end pt-2">
                                  <Button variant="ghost" onClick={() => setSelectedRole(null)}>Back</Button>
                               </div>
                             </div>
                          ) : residentCreationMode === 'manual' ? (
                            <AddResidentForm
                              blocks={blocks}
                              flats={flats}
                              onSubmit={(data) => addResidentMutation.mutate(data)}
                              isLoading={addResidentMutation.isPending}
                              onCancel={() => setResidentCreationMode(null)}
                            />
                          ) : (
                             <BulkResidentForm 
                               onSuccess={() => refetchUsers()}
                               onCancel={() => setResidentCreationMode(null)}
                             />
                          )
                        ) : (
                          <AddSystemUserForm 
                            role={selectedRole}
                            onSubmit={(data) => addSystemUserMutation.mutate({ ...data, role: selectedRole })}
                            isLoading={addSystemUserMutation.isPending}
                            onCancel={() => setSelectedRole(null)}
                          />
                        )}
                      </>
                    )}
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sortedUsers.length === 0 ? (
                    <p className="text-slate-500 text-center py-8">No users added yet</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-slate-50">
                            <th className="text-left p-2 font-semibold">Username</th>
                            <th className="text-left p-2 font-semibold">Role</th>
                            <th className="text-left p-2 font-semibold">Block</th>
                            <th className="text-left p-2 font-semibold">Flat</th>
                            <th className="text-left p-2 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedUsers.map((user) => (
                            <tr key={user.id} className="border-b hover:bg-slate-50">
                              <td className="p-2 font-medium">{user.username}</td>
                              <td className="p-2">
                                <span className={`text-xs px-2 py-1 rounded capitalize font-medium
                                  ${user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 
                                    user.role === 'guard' ? 'bg-blue-100 text-blue-800' : 
                                    'bg-slate-100 text-slate-800'}`}>
                                  {user.role}
                                </span>
                              </td>
                              <td className="p-2">{user.flat?.block?.name || "-"}</td>
                              <td className="p-2">{user.flat?.number || "-"}</td>
                              <td className="p-2">
                                <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                                  Active
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Blocks Tab */}
          <TabsContent value="blocks" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Blocks</CardTitle>
                  <p className="text-sm text-slate-500 mt-1">Manage society blocks</p>
                </div>
                <Dialog open={addBlockOpen} onOpenChange={setAddBlockOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-add-block">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Block
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add New Blocks</DialogTitle>
                    </DialogHeader>
                    <AddBlockForm
                      onSubmit={(data) => addBlockMutation.mutate(data)}
                      isLoading={addBlockMutation.isPending}
                    />
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {blocks.map((block) => (
                    <div
                      key={block.id}
                      className="p-4 border rounded-lg hover:bg-slate-50 transition"
                      data-testid={`card-block-${block.id}`}
                    >
                      <h3 className="font-semibold text-slate-900">{block.name}</h3>
                      <p className="text-sm text-slate-500">ID: {block.id}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Flats Tab */}
          <TabsContent value="flats" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Flats</CardTitle>
                  <p className="text-sm text-slate-500 mt-1">Manage flats by block</p>
                </div>
                <Dialog open={addFlatOpen} onOpenChange={setAddFlatOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-add-flat">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Flat
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add New Flat</DialogTitle>
                    </DialogHeader>
                    <AddFlatForm
                      blocks={blocks}
                      onSubmit={(data) => addFlatMutation.mutate(data)}
                      isLoading={addFlatMutation.isPending}
                    />
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {blocks.map((block) => (
                    <div key={block.id}>
                      <h3 className="font-semibold text-slate-900 mb-3">{block.name}</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {(flats[block.id] || []).map((flat) => (
                          <div
                            key={flat.id}
                            className="p-3 border rounded-lg bg-slate-50 text-center"
                            data-testid={`card-flat-${flat.id}`}
                          >
                            <p className="font-semibold">Flat {flat.number}</p>
                            <p className="text-xs text-slate-500">Floor {flat.floor}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

function AddResidentForm({
  blocks,
  flats,
  onSubmit,
  isLoading,
  onCancel,
}) {
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    phone: "",
    blockId: "",
    flatId: "",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      username: formData.username,
      password: formData.password,
      phone: formData.phone,
      flatId: formData.flatId || undefined,
    });
  };

  const selectedBlockFlats = formData.blockId ? flats[formData.blockId] || [] : [];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          placeholder="Enter username"
          value={formData.username}
          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          required
          data-testid="input-username"
        />
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          placeholder="Enter password"
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          required
          data-testid="input-password"
        />
      </div>

      <div>
        <Label htmlFor="phone">Phone (Optional)</Label>
        <Input
          id="phone"
          placeholder="Enter phone number"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          data-testid="input-phone"
        />
      </div>

      <div>
        <Label htmlFor="block">Block</Label>
        <Select value={formData.blockId} onValueChange={(value) => setFormData({ ...formData, blockId: value, flatId: "" })}>
          <SelectTrigger data-testid="select-block">
            <SelectValue placeholder="Select block" />
          </SelectTrigger>
          <SelectContent>
            {blocks.map((block) => (
              <SelectItem key={block.id} value={String(block.id)}>
                {block.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {formData.blockId && (
        <div>
          <Label htmlFor="flat">Flat</Label>
          <Select value={formData.flatId} onValueChange={(value) => setFormData({ ...formData, flatId: value })}>
            <SelectTrigger data-testid="select-flat">
              <SelectValue placeholder="Select flat" />
            </SelectTrigger>
            <SelectContent>
              {selectedBlockFlats.map((flat) => (
                <SelectItem key={flat.id} value={String(flat.id)}>
                  Flat {flat.number} (Floor {flat.floor})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="w-1/3" onClick={onCancel}>Back</Button>
        <Button type="submit" disabled={isLoading} className="w-2/3" data-testid="button-create-resident">
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            "Create Resident"
          )}
        </Button>
      </div>
    </form>
  );
}

function AddSystemUserForm({
  role,
  onSubmit,
  isLoading,
  onCancel
}) {
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    phone: "",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          placeholder="Enter username"
          value={formData.username}
          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          required
        />
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          placeholder="Enter password"
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          required
        />
      </div>

      <div>
        <Label htmlFor="phone">Phone (Optional)</Label>
        <Input
          id="phone"
          placeholder="Enter phone number"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
        />
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="w-1/3" onClick={onCancel}>Back</Button>
        <Button type="submit" disabled={isLoading} className="w-2/3">
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            `Create ${role.charAt(0).toUpperCase() + role.slice(1)}`
          )}
        </Button>
      </div>
    </form>
  );
}

function AddBlockForm({ onSubmit, isLoading }) {
  const [count, setCount] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ count });
    setCount("");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="count">Number of Blocks</Label>
        <Input
          id="count"
          type="number"
          min={1}
          max={26}
          placeholder="Enter number of blocks (e.g., 3)"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          required
          data-testid="input-block-count"
        />
      </div>
      <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-create-block">
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Creating...
          </>
        ) : (
          "Create Blocks"
        )}
      </Button>
    </form>
  );
}

function AddFlatForm({ blocks, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    blockId: "all",
    floors: "",
    flatsPerFloor: "",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      blockId: formData.blockId,
      floors: formData.floors,
      flatsPerFloor: formData.flatsPerFloor,
    });
    setFormData({ blockId: "all", floors: "", flatsPerFloor: "" });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-blue-50 p-3 rounded-md mb-4">
        <p className="text-sm text-blue-700">
          <strong>Bulk Generator:</strong> This will automatically create flats for the selected blocks.
          Existing flats will be skipped.
        </p>
      </div>

      <div>
        <Label htmlFor="block">Target Block(s)</Label>
        <Select
          value={formData.blockId}
          onValueChange={(value) => setFormData({ ...formData, blockId: value })}
        >
          <SelectTrigger data-testid="select-block">
            <SelectValue placeholder="Select block" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="font-semibold">All Blocks (Apply to all)</SelectItem>
            {blocks.map((block) => (
              <SelectItem key={block.id} value={String(block.id)}>
                {block.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="floors">Number of Floors</Label>
          <Input
            id="floors"
            type="number"
            min="1"
            max="100"
            placeholder="e.g. 5"
            value={formData.floors}
            onChange={(e) => setFormData({ ...formData, floors: e.target.value })}
            required
            data-testid="input-floors"
          />
        </div>
        <div>
          <Label htmlFor="flatsPerFloor">Flats per Floor</Label>
          <Input
            id="flatsPerFloor"
            type="number"
            min="1"
            max="20"
            placeholder="e.g. 4"
            value={formData.flatsPerFloor}
            onChange={(e) => setFormData({ ...formData, flatsPerFloor: e.target.value })}
            required
            data-testid="input-flats-per-floor"
          />
        </div>
      </div>

      <div className="text-xs text-slate-500">
        Output example: Floor 1 → 101-{100 + (parseInt(formData.flatsPerFloor) || 4)}
      </div>

      <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-create-flat">
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Generating Flats...
          </>
        ) : (
          "Generate Flats"
        )}
      </Button>
    </form>
  );
}

function BulkResidentForm({ onCancel, onSuccess }) {
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);

  const handleProcess = async () => {
     if (!file) return;
     setIsProcessing(true);
     try {
        const user = await storage.getCurrentUser();
        if (!user || !user.residencyId) throw new Error("User session invalid");

        const formData = new FormData();
        formData.append("file", file);
        formData.append("residencyId", user.residencyId);

        const response = await fetch("/api/upload-residents-pdf", {
           method: "POST",
           body: formData,
        });

        const text = await response.text();
        let res;
        try {
           res = JSON.parse(text);
        } catch {
           console.error("Server returned non-JSON:", text);
           throw new Error("Server returned invalid response");
        }
        
        if (!response.ok) {
           throw new Error(res.error || "Failed to process PDF");
        }

        setResult(res);
        if (onSuccess) onSuccess();

     } catch (e) {
        console.error(e);
        alert(e.message); 
     } finally {
        setIsProcessing(false);
     }
  };

  if (result) {
     return (
        <div className="space-y-4">
           <div className="bg-green-50 p-4 rounded-md">
              <h3 className="font-semibold text-green-800 flex items-center gap-2">
                 <CheckCircle className="w-5 h-5" /> Processing Complete
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-green-700">
                 <li>Created: <strong>{result.created}</strong></li>
                 <li>Skipped: <strong>{result.skipped}</strong></li>
                 <li>Failed: <strong>{result.failed}</strong></li>
              </ul>
           </div>
           {result.details.length > 0 && (
             <div className="max-h-40 overflow-y-auto text-xs border rounded p-2 bg-slate-50">
               {result.details.map((d, i) => (
                 <div key={i} className={`mb-1 ${d.status === 'failed' ? 'text-red-600' : 'text-amber-600'}`}>
                   [{d.status.toUpperCase()}] {d.reason} ({d.name})
                 </div>
               ))}
             </div>
           )}
           <Button onClick={onCancel} className="w-full">Close</Button>
        </div>
     )
  }

  return (
     <div className="space-y-4">
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:bg-slate-50 transition-colors relative">
           <input 
             type="file" 
             accept=".pdf" 
             onChange={e => setFile(e.target.files[0])} 
             className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
             id="pdf-upload" 
           />
           <div className="pointer-events-none">
              <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
              <div className="text-sm font-medium text-slate-900">
                 {file ? file.name : "Click to upload PDF"}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                 Format: Block [Name] [Flat] [Resident Name] [Phone]
              </div>
           </div>
        </div>
        
        {file && (
           <Button onClick={handleProcess} disabled={isProcessing} className="w-full">
              {isProcessing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing...</> : "Process & Create Residents"}
           </Button>
        )}
        <Button variant="ghost" onClick={onCancel} className="w-full">Cancel</Button>
     </div>
  );
}

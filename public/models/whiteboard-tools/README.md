# Whiteboard tools

Dry-erase markers (black, blue, red) and the eraser, taken from the ProtoGen Alyx-Physics project
(`protogen-org/ProtoGen-WebXR-Development`, `projects/Alyx-Physics/public/models/alyx/`). They were built there
by `scripts/build-alyx-models.py` from the TheBasement-Unity reference project.

- `tools.glb`: only the four meshes `Alyx_Marker_{Black,Blue,Red}_Mesh` and `Eraser_Mesh`, extracted from
  `parts.glb` with glTF-Transform (geometry only, no materials).
- `<Prop>_{c,n,orm}.jpg`: each prop's baked base color, normal and ORM (occlusion, roughness, metalness) maps.

Mesh conventions (raw geometry, node rotation ignored): the marker's nib points along -z (tip at z = -0.0745),
and the eraser's felt pad faces -y (bottom at y = -0.019).

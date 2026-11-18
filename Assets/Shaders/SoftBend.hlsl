#ifndef SOFT_BEND_INCLUDED
#define SOFT_BEND_INCLUDED

// Set every frame by SoftBendPlayer.cs (globals, so materials stay SRP-Batcher friendly).
float4 _SoftBendPlayer;   // xyz = player's feet, w = radius the player pushes within (metres)
float4 _SoftBendParams;   // x = strength, y = height that bends fully (metres), z = idle sway, w = sway speed

// Leans the object away from the player. The base stays planted and the tip moves most.
// Needs the object's pivot at its base (true for the Kenney models) and no static batching.
float3 SoftBendPositionOS(float3 positionOS)
{
    float3 originWS = GetObjectToWorldMatrix()._m03_m13_m23;
    float3 positionWS = TransformObjectToWorld(positionOS);

    float bendHeight = max(_SoftBendParams.y, 1e-3);
    float height = max(positionWS.y - originWS.y, 0.0);
    float tip = saturate(height / bendHeight);
    tip *= tip;                                         // curve: bends like a stem, not a hinge

    // How hard the player is pushing: strongest up close, nothing beyond the radius or far above/below.
    float2 away = originWS.xz - _SoftBendPlayer.xz;
    float dist = length(away);
    float push = saturate(1.0 - dist / max(_SoftBendPlayer.w, 1e-3));
    push = push * push * (3.0 - 2.0 * push);
    push *= saturate(1.0 - abs(_SoftBendPlayer.y - originWS.y) / 1.5);
    push *= _SoftBendParams.x;
    float2 dir = dist > 1e-4 ? away / dist : float2(1.0, 0.0);

    // A gentle breeze, out of step from plant to plant.
    float phase = originWS.x * 1.7 + originWS.z * 1.3;
    float2 sway = float2(sin(_Time.y * _SoftBendParams.w + phase), sin(_Time.y * _SoftBendParams.w * 0.8 + phase * 1.3) * 0.6) * _SoftBendParams.z;

    float3 offsetWS;
    offsetWS.xz = (dir * push + sway) * tip * bendHeight;
    offsetWS.y = -push * tip * height * 0.35;           // squash down a little so it doesn't look stretched

    return positionOS + mul((float3x3)GetWorldToObjectMatrix(), offsetWS);
}

#endif

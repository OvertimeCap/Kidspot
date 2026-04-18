import { Stack } from "expo-router";

export default function PartnerLayout() {
  return (
    <Stack>
      <Stack.Screen name="fotos" options={{ title: "Gerenciar Fotos" }} />
    </Stack>
  );
}

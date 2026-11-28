import { type ReactNode, useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius, space, useTheme } from "@/lib/theme";

const OPEN_MS = 260;
const CLOSE_MS = 200;

/**
 * Hoja que sube desde abajo. El fondo oscuro aparece de a poco en su lugar y solo la hoja se
 * desliza (con `animationType="slide"` del Modal subía todo junto, fondo incluido). Al cerrar
 * se anima la salida y recién después se desmonta. Sin movimiento si el teléfono pide reducirlo.
 */
export function BottomSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [height, setHeight] = useState(0);
  const [progress] = useState(() => new Animated.Value(0));
  const reduceMotion = useReduceMotion();

  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    // Se espera a medir la hoja para que arranque justo debajo del borde de la pantalla.
    if (!mounted || (visible && height === 0)) return;
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : visible ? OPEN_MS : CLOSE_MS,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false);
        setHeight(0);
      }
    });
    return () => animation.stop();
  }, [visible, mounted, height, progress, reduceMotion]);

  if (!mounted) return null;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [height || 1000, 0] });
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar" />
        </Animated.View>
        <Animated.View
          onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
          style={[
            styles.sheet,
            { backgroundColor: t.background, paddingBottom: Math.max(insets.bottom, space.lg), transform: [{ translateY }] },
          ]}
          accessibilityViewIsModal
        >
          <View style={[styles.grabber, { backgroundColor: t.border }]} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: radius.pill, marginTop: space.sm, marginBottom: space.md },
});

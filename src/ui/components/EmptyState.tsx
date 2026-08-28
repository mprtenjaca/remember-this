import React from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Display, Body } from './Txt';
import { Button } from './Button';
import { Glass } from './Glass';
import { S } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  title: string;
  body?: string;
  icon?: IoniconName;
  action?: { title: string; onPress: () => void };
}

/** Empty states are a call to action, not atmosphere. */
export function EmptyState({ title, body, icon = 'sparkles-outline', action }: Props) {
  const t = useTheme();
  return (
    <Glass radius={30} style={styles.wrap}>
      <View style={styles.inner}>
        <View style={[styles.iconWrap, { backgroundColor: t.c.accentSoft }]}>
          <Ionicons name={icon} size={22} color={t.c.ion} />
        </View>
        <Display size="xl" weight="semi" style={{ marginTop: S.lg }}>
          {title}
        </Display>
        {body ? (
          <Body tone="fg2" style={{ marginTop: S.sm }}>
            {body}
          </Body>
        ) : null}
        {action ? <Button title={action.title} onPress={action.onPress} variant="primary" icon="mic" style={{ marginTop: S.xl, alignSelf: 'flex-start' }} /> : null}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: S.md },
  inner: { padding: S.xl },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});

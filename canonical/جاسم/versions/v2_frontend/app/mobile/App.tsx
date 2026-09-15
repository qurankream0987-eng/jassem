/**
 * JASIM Mobile App - Main Entry Point
 * جاسم - التطبيق الجوال
 *
 * Expo SDK 52 + React Navigation + tRPC
 * Connects to the same backend as the web app
 */

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { TRPCProvider } from './src/providers/TRPCProvider';
import { AuthProvider } from './src/hooks/useAuth';
import HomeScreen from './src/screens/HomeScreen';
import ChatScreen from './src/screens/ChatScreen';
import MerchantScreen from './src/screens/MerchantScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <TRPCProvider>
      <AuthProvider>
        <NavigationContainer>
          <StatusBar style="light" />
          <Tab.Navigator
            screenOptions={({ route }) => ({
              headerStyle: {
                backgroundColor: '#0a0a1a',
              },
              headerTintColor: '#00d4ff',
              headerTitleStyle: {
                fontWeight: 'bold',
                fontSize: 18,
              },
              tabBarStyle: {
                backgroundColor: '#0a0a1a',
                borderTopColor: '#1a1a3e',
                height: 70,
                paddingBottom: 10,
              },
              tabBarActiveTintColor: '#00d4ff',
              tabBarInactiveTintColor: '#666',
              tabBarIcon: ({ focused, color, size }) => {
                let iconName: keyof typeof Ionicons.glyphMap = 'home';

                switch (route.name) {
                  case 'Home':
                    iconName = focused ? 'home' : 'home-outline';
                    break;
                  case 'Chat':
                    iconName = focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline';
                    break;
                  case 'Merchant':
                    iconName = focused ? 'storefront' : 'storefront-outline';
                    break;
                  case 'Profile':
                    iconName = focused ? 'person' : 'person-outline';
                    break;
                }

                return <Ionicons name={iconName} size={size} color={color} />;
              },
            })}
          >
            <Tab.Screen
              name="Home"
              component={HomeScreen}
              options={{ title: 'الرئيسية' }}
            />
            <Tab.Screen
              name="Chat"
              component={ChatScreen}
              options={{ title: 'جاسم' }}
            />
            <Tab.Screen
              name="Merchant"
              component={MerchantScreen}
              options={{ title: 'متجري' }}
            />
            <Tab.Screen
              name="Profile"
              component={ProfileScreen}
              options={{ title: 'حسابي' }}
            />
          </Tab.Navigator>
        </NavigationContainer>
      </AuthProvider>
    </TRPCProvider>
  );
}

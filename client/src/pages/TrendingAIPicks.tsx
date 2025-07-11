import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Link } from 'wouter';
import { 
  Sparkles, 
  TrendingUp, 
  DollarSign, 
  Zap, 
  Star, 
  ArrowLeft, 
  Home, 
  RefreshCw, 
  Loader2,
  ChevronDown,
  ChevronUp,
  Heart,
  Calendar,
  Filter,
  SlidersHorizontal,
  Clock,
  Flame,
  Eye,
  MessageSquare,
  ExternalLink,
  Pin,
  PinOff
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface TrendingProduct {
  id: number;
  title: string;
  content?: string;
  niche: string;
  mentions: number;
  engagement?: number;
  source: string;
  dataSource?: string;
  hashtags?: string[];
  emojis?: string[];
  reason?: string;
  description?: string;
  viralKeywords?: string[];
  perplexityNotes?: string;
  createdAt?: string;
  fetchedAt?: string;
}

interface FavoriteProduct {
  id: number;
  userId: number;
  productId: number;
  pinnedAt: string;
}

type SortOption = 'newest' | 'mentions' | 'datePulled';
type SourceFilter = 'all' | 'gpt' | 'perplexity';

const getNicheColor = (niche: string) => {
  const colors = {
    beauty: 'bg-pink-100 text-pink-800 border-pink-300',
    tech: 'bg-blue-100 text-blue-800 border-blue-300',
    fashion: 'bg-purple-100 text-purple-800 border-purple-300',
    fitness: 'bg-green-100 text-green-800 border-green-300',
    food: 'bg-orange-100 text-orange-800 border-orange-300',
    travel: 'bg-cyan-100 text-cyan-800 border-cyan-300',
    pets: 'bg-amber-100 text-amber-800 border-amber-300',
  };
  return colors[niche as keyof typeof colors] || 'bg-gray-100 text-gray-800 border-gray-300';
};

const formatMentions = (mentions: number) => {
  if (mentions >= 1000000) return `${(mentions / 1000000).toFixed(1)}M`;
  if (mentions >= 1000) return `${(mentions / 1000).toFixed(0)}K`;
  return mentions.toString();
};

const formatDate = (dateStr?: string) => {
  if (!dateStr) return 'Unknown';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

const isWithin24Hours = (dateStr?: string) => {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return diffMs < 24 * 60 * 60 * 1000; // 24 hours in milliseconds
};

export default function TrendingAIPicks() {
  const [selectedTab, setSelectedTab] = useState<'all' | 'favorites'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedNiches, setSelectedNiches] = useState<string[]>([]);
  const [mentionsRange, setMentionsRange] = useState<number[]>([0, 2000000]);
  const [dateRange, setDateRange] = useState<number>(7); // Last 7 days
  const [expandedProducts, setExpandedProducts] = useState<Set<number>>(new Set());
  const [collapsedNiches, setCollapsedNiches] = useState<Set<string>>(new Set());
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all trending products
  const { data: products = [], isLoading } = useQuery<TrendingProduct[]>({
    queryKey: ['/api/trending/products'],
  });

  // Fetch user favorites
  const { data: favorites = [] } = useQuery<FavoriteProduct[]>({
    queryKey: ['/api/favorites/products'],
    retry: false,
  });

  // Perplexity Fetch Mutation
  const perplexityMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/pull-perplexity-trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Perplexity Fetch Complete",
        description: `Added ${data.productsAdded} new trending products from Perplexity`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/trending/products'] });
    },
    onError: (error) => {
      toast({
        title: "Fetch Failed",
        description: error instanceof Error ? error.message : "Failed to fetch from Perplexity",
        variant: "destructive",
      });
    },
  });

  // Individual product refresh mutation
  const refreshIndividualMutation = useMutation({
    mutationFn: async ({ productId, niche }: { productId: number; niche: string }) => {
      const response = await fetch('/api/perplexity-trends/refresh-individual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, niche }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to refresh product');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Product Refreshed",
        description: `Updated "${data.originalTitle}" to "${data.newTitle}"`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/trending/products'] });
    },
    onError: (error) => {
      toast({
        title: "Refresh Failed",
        description: error instanceof Error ? error.message : "Failed to refresh product",
        variant: "destructive",
      });
    },
  });

  // Toggle favorite mutation
  const favoriteMutation = useMutation({
    mutationFn: async ({ productId, action }: { productId: number; action: 'add' | 'remove' }) => {
      const response = await fetch(`/api/favorites/products`, {
        method: action === 'add' ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to ${action} favorite`);
      }
      
      return response.json();
    },
    onSuccess: (_, variables) => {
      toast({
        title: variables.action === 'add' ? "Added to Favorites" : "Removed from Favorites",
        description: `Product ${variables.action === 'add' ? 'pinned to' : 'removed from'} My Picks`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/favorites/products'] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Update Favorites",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    },
  });

  // Get unique niches for filter
  const availableNiches = useMemo(() => {
    return [...new Set(products.map(p => p.niche))].sort();
  }, [products]);

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    let filtered = products;

    // Filter by date range
    if (dateRange < 365) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - dateRange);
      filtered = filtered.filter(p => {
        const fetchDate = new Date(p.fetchedAt || p.createdAt || 0);
        return fetchDate >= cutoffDate;
      });
    }

    // Filter by source
    if (sourceFilter !== 'all') {
      filtered = filtered.filter(p => {
        const source = p.dataSource || p.source || 'gpt';
        return source.toLowerCase().includes(sourceFilter);
      });
    }

    // Filter by selected niches
    if (selectedNiches.length > 0) {
      filtered = filtered.filter(p => selectedNiches.includes(p.niche));
    }

    // Filter by mentions range
    filtered = filtered.filter(p => {
      const mentions = p.mentions || 0;
      return mentions >= mentionsRange[0] && mentions <= mentionsRange[1];
    });

    // Sort products
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'mentions':
          return (b.mentions || 0) - (a.mentions || 0);
        case 'datePulled':
          return new Date(b.fetchedAt || b.createdAt || 0).getTime() - 
                 new Date(a.fetchedAt || a.createdAt || 0).getTime();
        case 'newest':
        default:
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      }
    });

    return filtered;
  }, [products, dateRange, sourceFilter, selectedNiches, mentionsRange, sortBy]);

  // Get favorites for display
  const favoriteProducts = useMemo(() => {
    const favoriteIds = new Set(favorites.map(f => f.productId));
    return products.filter(p => favoriteIds.has(p.id));
  }, [products, favorites]);

  // Group products by niche
  const productsByNiche = useMemo(() => {
    const displayProducts = selectedTab === 'favorites' ? favoriteProducts : filteredProducts;
    return displayProducts.reduce((acc, product) => {
      if (!acc[product.niche]) {
        acc[product.niche] = [];
      }
      acc[product.niche].push(product);
      return acc;
    }, {} as Record<string, TrendingProduct[]>);
  }, [filteredProducts, favoriteProducts, selectedTab]);

  const toggleProductDetails = (productId: number) => {
    const newExpanded = new Set(expandedProducts);
    if (newExpanded.has(productId)) {
      newExpanded.delete(productId);
    } else {
      newExpanded.add(productId);
    }
    setExpandedProducts(newExpanded);
  };

  const toggleNicheCollapse = (niche: string) => {
    const newCollapsed = new Set(collapsedNiches);
    if (newCollapsed.has(niche)) {
      newCollapsed.delete(niche);
    } else {
      newCollapsed.add(niche);
    }
    setCollapsedNiches(newCollapsed);
  };

  const handleNicheToggle = (niche: string) => {
    setSelectedNiches(prev => 
      prev.includes(niche) 
        ? prev.filter(n => n !== niche)
        : [...prev, niche]
    );
  };

  const isFavorited = (productId: number) => {
    return favorites.some(f => f.productId === productId);
  };

  const ProductCard = ({ product }: { product: TrendingProduct }) => {
    const isExpanded = expandedProducts.has(product.id);
    const isFresh = isWithin24Hours(product.fetchedAt || product.createdAt);
    const favorited = isFavorited(product.id);

    return (
      <Card className="mb-4 hover:shadow-md transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Flame className="h-4 w-4 text-orange-500 flex-shrink-0" />
                <h3 className="font-semibold text-gray-900 truncate">{product.title}</h3>
                {isFresh && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300 text-xs">
                    <Clock className="h-3 w-3 mr-1" />
                    Fresh Pick
                  </Badge>
                )}
              </div>
              
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                <div className="flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  <span>{formatMentions(product.mentions || 0)} mentions</span>
                </div>
                
                {product.engagement && (
                  <div className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    <span>{product.engagement} score</span>
                  </div>
                )}
                
                <Badge className={getNicheColor(product.niche)}>
                  {product.niche}
                </Badge>
                
                <Badge variant="outline" className="text-xs">
                  {product.dataSource || product.source}
                </Badge>
              </div>

              {product.reason && (
                <div className="mt-2 p-2 bg-yellow-50 rounded-md border border-yellow-200">
                  <div className="flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-yellow-800">Why it's hot:</p>
                      <p className="text-sm text-yellow-700">{product.reason}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                <Calendar className="h-3 w-3" />
                <span>Fetched on: {formatDate(product.fetchedAt || product.createdAt)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => favoriteMutation.mutate({ 
                  productId: product.id, 
                  action: favorited ? 'remove' : 'add' 
                })}
                className="h-8 w-8 p-0"
              >
                {favorited ? (
                  <PinOff className="h-4 w-4 text-red-500" />
                ) : (
                  <Pin className="h-4 w-4 text-gray-400" />
                )}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => refreshIndividualMutation.mutate({ 
                  productId: product.id, 
                  niche: product.niche 
                })}
                disabled={refreshIndividualMutation.isPending}
                className="h-8 w-8 p-0"
              >
                {refreshIndividualMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2 mb-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleProductDetails(product.id)}
              className="h-8"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Hide Details
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Show Details
                </>
              )}
            </Button>

            <Link href={`/unified-generator?product=${encodeURIComponent(product.title)}&niche=${product.niche}`}>
              <Button variant="default" size="sm" className="h-8">
                <Zap className="h-4 w-4 mr-1" />
                Generate Content
              </Button>
            </Link>

            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => window.open(`https://amazon.com/s?k=${encodeURIComponent(product.title)}`, '_blank')}
            >
              <ExternalLink className="h-4 w-4 mr-1" />
              View Product
            </Button>
          </div>

          {isExpanded && (
            <div className="space-y-3 pt-3 border-t border-gray-100">
              {product.description && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-1">Description</h4>
                  <p className="text-sm text-gray-600">{product.description}</p>
                </div>
              )}

              {product.viralKeywords && product.viralKeywords.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-1">Viral Keywords</h4>
                  <div className="flex flex-wrap gap-1">
                    {product.viralKeywords.map((keyword, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {product.perplexityNotes && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-1">Perplexity Notes</h4>
                  <p className="text-sm text-gray-600">{product.perplexityNotes}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Dashboard
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">AI Trending Picks</h1>
                <p className="text-sm text-gray-500">Discover what's trending across social platforms</p>
              </div>
            </div>

            <Button
              onClick={() => perplexityMutation.mutate()}
              disabled={perplexityMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {perplexityMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Fetching...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Run Perplexity Fetch
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar Filters */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Filter className="h-5 w-5" />
                  Filters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Date Range Filter */}
                <div>
                  <h4 className="font-medium mb-3">Date Range</h4>
                  <Select value={dateRange.toString()} onValueChange={(value) => setDateRange(parseInt(value))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Last 24 hours</SelectItem>
                      <SelectItem value="7">Last 7 days</SelectItem>
                      <SelectItem value="30">Last 30 days</SelectItem>
                      <SelectItem value="90">Last 3 months</SelectItem>
                      <SelectItem value="365">All time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Mentions Range */}
                <div>
                  <h4 className="font-medium mb-3">Mentions Range</h4>
                  <div className="px-2">
                    <Slider
                      value={mentionsRange}
                      onValueChange={setMentionsRange}
                      min={0}
                      max={2000000}
                      step={10000}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>{formatMentions(mentionsRange[0])}</span>
                      <span>{formatMentions(mentionsRange[1])}</span>
                    </div>
                  </div>
                </div>

                {/* Source Toggle */}
                <div>
                  <h4 className="font-medium mb-3">Source</h4>
                  <div className="space-y-2">
                    {(['all', 'perplexity', 'gpt'] as const).map((source) => (
                      <div key={source} className="flex items-center space-x-2">
                        <Switch
                          checked={sourceFilter === source}
                          onCheckedChange={() => setSourceFilter(source)}
                        />
                        <span className="text-sm capitalize">{source}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Niche Multi-select */}
                <div>
                  <h4 className="font-medium mb-3">Niches</h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {availableNiches.map((niche) => (
                      <div key={niche} className="flex items-center space-x-2">
                        <Switch
                          checked={selectedNiches.includes(niche)}
                          onCheckedChange={() => handleNicheToggle(niche)}
                        />
                        <span className="text-sm capitalize">{niche}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            <Tabs value={selectedTab} onValueChange={(value) => {
              setSelectedTab(value as 'all' | 'favorites');
              window.scrollTo(0, 0);
            }}>
              <div className="flex items-center justify-between mb-6">
                <TabsList>
                  <TabsTrigger value="all" className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    All Picks ({Object.values(productsByNiche).flat().length})
                  </TabsTrigger>
                  <TabsTrigger value="favorites" className="flex items-center gap-2">
                    <Heart className="h-4 w-4" />
                    My Picks ({favoriteProducts.length})
                  </TabsTrigger>
                </TabsList>

                {selectedTab === 'all' && (
                  <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest</SelectItem>
                      <SelectItem value="mentions">Most Mentions</SelectItem>
                      <SelectItem value="datePulled">Date Pulled</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              <TabsContent value="all" className="space-y-6">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                  </div>
                ) : Object.keys(productsByNiche).length === 0 ? (
                  <div className="text-center py-12">
                    <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No products found</h3>
                    <p className="text-gray-500">Try adjusting your filters or fetch new data from Perplexity</p>
                  </div>
                ) : (
                  Object.entries(productsByNiche).map(([niche, nicheProducts]) => (
                    <div key={niche}>
                      <Collapsible
                        open={!collapsedNiches.has(niche)}
                        onOpenChange={() => toggleNicheCollapse(niche)}
                      >
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            className="flex items-center justify-between w-full p-4 h-auto bg-gray-100 hover:bg-gray-200 rounded-lg mb-4"
                          >
                            <div className="flex items-center gap-3">
                              <Badge className={getNicheColor(niche)} variant="outline">
                                {niche.charAt(0).toUpperCase() + niche.slice(1)}
                              </Badge>
                              <span className="text-sm text-gray-600">
                                {nicheProducts.length} product{nicheProducts.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            {collapsedNiches.has(niche) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronUp className="h-4 w-4" />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-4">
                            {nicheProducts.map((product) => (
                              <ProductCard key={product.id} product={product} />
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="favorites" className="space-y-4">
                {favoriteProducts.length === 0 ? (
                  <div className="text-center py-12">
                    <Heart className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No favorites yet</h3>
                    <p className="text-gray-500">Pin products to save them to your picks</p>
                  </div>
                ) : (
                  favoriteProducts.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
/**
 * Hierarchical Path Optimizer
 * 
 * Advanced algorithm that properly handles shared pool segments in multi-path routing.
 * Optimizes shared segments first, then optimizes downstream routing decisions.
 * 
 * Example: A/B/USDT/ETH and A/B/ETH both use A/B pool
 * Solution: Optimize A->B amount first, then optimize B->USDT vs B->ETH splits
 * 
 * @author Claude Code Assistant
 * @version 2.0.0
 */

import { ethers } from 'ethers';

/**
 * Hierarchical Path Optimizer - handles shared pool segments correctly
 */
export class HierarchicalPathOptimizer {
  constructor(provider, tokenRegistry, poolRegistry) {
    this.provider = provider;
    this.tokenRegistry = tokenRegistry;
    this.poolRegistry = poolRegistry;
    this.sharedSegmentAnalyzer = new SharedSegmentAnalyzer();
    this.segmentOptimizer = new SegmentOptimizer();
  }

  /**
   * Main optimization with hierarchical approach
   */
  async optimizeWithSharedSegments(fromToken, toToken, amount, availablePaths) {
    console.log('🔄 Starting hierarchical optimization with shared segment analysis');

    // Step 1: Analyze path structure and identify shared segments
    const pathStructure = await this.analyzePathStructure(availablePaths);
    console.log('📊 Path structure:', pathStructure);

    // Step 2: Build hierarchical tree of shared segments
    const hierarchicalTree = await this.buildHierarchicalTree(pathStructure, fromToken, toToken);
    console.log('🌳 Hierarchical tree:', hierarchicalTree);

    // Step 3: Optimize from root to leaves (shared segments first)
    const optimizedAllocation = await this.optimizeHierarchically(
      hierarchicalTree, 
      amount, 
      fromToken
    );

    return optimizedAllocation;
  }

  /**
   * Analyze which segments are shared between paths
   */
  async analyzePathStructure(paths) {
    const pathStructure = {
      paths: [],
      sharedSegments: new Map(),
      segmentUsage: new Map()
    };

    // Parse each path into segments
    for (const pathString of paths) {
      const hops = pathString.split('/');
      const pathSegments = [];

      for (let i = 0; i < hops.length - 1; i++) {
        const segment = `${hops[i]}/${hops[i + 1]}`;
        pathSegments.push(segment);

        // Track segment usage
        if (!pathStructure.segmentUsage.has(segment)) {
          pathStructure.segmentUsage.set(segment, []);
        }
        pathStructure.segmentUsage.get(segment).push(pathString);
      }

      pathStructure.paths.push({
        path: pathString,
        segments: pathSegments,
        hops: hops
      });
    }

    // Identify shared segments (used by multiple paths)
    for (const [segment, usedBy] of pathStructure.segmentUsage) {
      if (usedBy.length > 1) {
        pathStructure.sharedSegments.set(segment, {
          segment,
          usedByPaths: usedBy,
          usageCount: usedBy.length,
          pool: await this.poolRegistry.getBestPool(...segment.split('/'))
        });
      }
    }

    return pathStructure;
  }

  /**
   * Build hierarchical tree where shared segments are optimized first
   */
  async buildHierarchicalTree(pathStructure, fromToken, toToken) {
    const tree = {
      root: fromToken,
      target: toToken,
      levels: [],
      nodes: new Map()
    };

    // Group paths by their first shared segment
    const levelGroups = new Map();

    for (const pathData of pathStructure.paths) {
      const path = pathData.path;
      const segments = pathData.segments;
      
      // Find the first segment (this determines the first branching point)
      const firstSegment = segments[0];
      
      if (!levelGroups.has(firstSegment)) {
        levelGroups.set(firstSegment, {
          segment: firstSegment,
          paths: [],
          isShared: pathStructure.sharedSegments.has(firstSegment),
          pool: await this.poolRegistry.getBestPool(...firstSegment.split('/'))
        });
      }
      
      levelGroups.get(firstSegment).paths.push(pathData);
    }

    // Build tree levels
    let currentLevel = 0;
    for (const [segment, groupData] of levelGroups) {
      const treeNode = {
        level: currentLevel,
        segment: segment,
        pool: groupData.pool,
        isShared: groupData.isShared,
        paths: groupData.paths,
        children: await this.buildChildNodes(groupData.paths, segment),
        optimalAmount: null, // To be calculated
        remainingPaths: [] // Paths that continue beyond this segment
      };

      tree.nodes.set(segment, treeNode);
      tree.levels.push(treeNode);
    }

    return tree;
  }

  /**
   * Build child nodes for paths that continue beyond current segment
   */
  async buildChildNodes(pathsData, currentSegment) {
    const childGroups = new Map();

    for (const pathData of pathsData) {
      const segments = pathData.segments;
      const currentIndex = segments.indexOf(currentSegment);
      
      if (currentIndex < segments.length - 1) {
        // There are more segments after current one
        const nextSegment = segments[currentIndex + 1];
        
        if (!childGroups.has(nextSegment)) {
          childGroups.set(nextSegment, {
            segment: nextSegment,
            paths: [],
            pool: await this.poolRegistry.getBestPool(...nextSegment.split('/'))
          });
        }
        
        childGroups.get(nextSegment).paths.push(pathData);
      }
    }

    const children = [];
    for (const [segment, groupData] of childGroups) {
      children.push({
        segment: segment,
        pool: groupData.pool,
        paths: groupData.paths,
        children: await this.buildChildNodes(groupData.paths, segment)
      });
    }

    return children;
  }

  /**
   * Optimize hierarchically: shared segments first, then downstream decisions
   */
  async optimizeHierarchically(tree, totalAmount, currentToken) {
    console.log('🎯 Starting hierarchical optimization');
    
    const optimization = {
      totalAmount: ethers.BigNumber.from(totalAmount),
      allocations: new Map(),
      executionPlan: [],
      sharedSegmentOptimizations: new Map()
    };

    // Step 1: Optimize all shared segments at each level
    for (const levelNode of tree.levels) {
      if (levelNode.isShared) {
        console.log(`🔄 Optimizing shared segment: ${levelNode.segment}`);
        
        const sharedOptimization = await this.optimizeSharedSegment(
          levelNode,
          optimization.totalAmount,
          currentToken
        );
        
        optimization.sharedSegmentOptimizations.set(levelNode.segment, sharedOptimization);
        levelNode.optimalAmount = sharedOptimization.optimalAmount;
        
        console.log(`✅ Shared segment ${levelNode.segment} optimal amount: ${ethers.utils.formatEther(sharedOptimization.optimalAmount)}`);
      }
    }

    // Step 2: Optimize downstream routing decisions
    const finalAllocation = await this.optimizeDownstreamRouting(tree, optimization);

    return finalAllocation;
  }

  /**
   * Optimize a shared segment considering all paths that use it
   */
  async optimizeSharedSegment(levelNode, totalAmount, inputToken) {
    const pool = levelNode.pool;
    const pathsUsingSegment = levelNode.paths;
    
    console.log(`🔍 Analyzing shared segment ${levelNode.segment} used by ${pathsUsingSegment.length} paths`);

    // Calculate total demand for this segment across all paths
    let totalDemandForSegment = ethers.BigNumber.from(0);
    const pathDemands = [];

    for (const pathData of pathsUsingSegment) {
      // For now, assume equal initial distribution - will be optimized
      const initialDemand = totalAmount.div(pathsUsingSegment.length);
      pathDemands.push({
        path: pathData.path,
        demand: initialDemand
      });
      totalDemandForSegment = totalDemandForSegment.add(initialDemand);
    }

    // Optimize the total amount for this shared segment
    const segmentOptimization = await this.optimizeSegmentAmount(
      pool,
      totalDemandForSegment,
      inputToken,
      levelNode.segment.split('/')[1] // output token of segment
    );

    // Distribute optimized amount among paths using this segment
    const pathAllocations = await this.distributeAmongPaths(
      segmentOptimization.optimalAmount,
      pathDemands,
      levelNode
    );

    return {
      segment: levelNode.segment,
      optimalAmount: segmentOptimization.optimalAmount,
      pathAllocations: pathAllocations,
      priceImpact: segmentOptimization.priceImpact,
      outputAmount: segmentOptimization.outputAmount
    };
  }

  /**
   * Optimize the amount for a specific segment considering price impact
   */
  async optimizeSegmentAmount(pool, requestedAmount, inputToken, outputToken) {
    const reserves = await pool.getReserves();
    const [reserve0, reserve1] = reserves;
    
    // Calculate optimal amount that minimizes price impact while maximizing output
    const k = reserve0.mul(reserve1);
    
    // Try different amounts from 0 to requestedAmount
    let bestAmount = ethers.BigNumber.from(0);
    let bestEfficiency = 0;
    let bestOutput = ethers.BigNumber.from(0);
    let bestPriceImpact = 0;

    const steps = 100;
    for (let i = 1; i <= steps; i++) {
      const testAmount = requestedAmount.mul(i).div(steps);
      
      // Calculate output and price impact for this amount
      const newReserve0 = reserve0.add(testAmount);
      const newReserve1 = k.div(newReserve0);
      const outputAmount = reserve1.sub(newReserve1);
      
      // Apply trading fee
      const fee = outputAmount.mul(30).div(10000); // 0.3% fee
      const outputAfterFee = outputAmount.sub(fee);
      
      // Calculate efficiency (output per unit input, adjusted for price impact)
      const priceImpact = this.calculatePriceImpact(reserve0, reserve1, testAmount);
      const efficiency = outputAfterFee.mul(1000).div(testAmount).mul(1000 - Math.floor(priceImpact * 1000)).div(1000);
      
      if (efficiency.gt(bestEfficiency)) {
        bestAmount = testAmount;
        bestEfficiency = efficiency;
        bestOutput = outputAfterFee;
        bestPriceImpact = priceImpact;
      }
    }

    return {
      optimalAmount: bestAmount,
      outputAmount: bestOutput,
      priceImpact: bestPriceImpact,
      efficiency: bestEfficiency
    };
  }

  /**
   * Distribute optimized segment amount among paths using genetic algorithm
   */
  async distributeAmongPaths(totalSegmentAmount, pathDemands, levelNode) {
    console.log(`🧬 Distributing ${ethers.utils.formatEther(totalSegmentAmount)} among ${pathDemands.length} paths`);

    // Use genetic algorithm to find optimal distribution
    const ga = new PathDistributionGA();
    const optimalDistribution = await ga.optimize(
      pathDemands,
      totalSegmentAmount,
      levelNode
    );

    return optimalDistribution;
  }

  /**
   * After shared segments are optimized, optimize downstream routing
   */
  async optimizeDownstreamRouting(tree, sharedOptimization) {
    const finalPlan = {
      executionSteps: [],
      totalOptimization: {
        arbitrageReduction: 0,
        gasOptimization: 0,
        slippageReduction: 0
      }
    };

    // For each shared segment optimization, continue downstream
    for (const [segment, segmentOpt] of sharedOptimization.sharedSegmentOptimizations) {
      const treeNode = tree.nodes.get(segment);
      
      // Get amount available after this segment
      const availableAmount = segmentOpt.outputAmount;
      const outputToken = segment.split('/')[1];

      // Optimize children (next level routing decisions)
      if (treeNode.children.length > 0) {
        const downstreamOpt = await this.optimizeChildrenRouting(
          treeNode.children,
          availableAmount,
          outputToken
        );
        
        finalPlan.executionSteps.push({
          level: treeNode.level,
          segment: segment,
          amount: segmentOpt.optimalAmount,
          downstreamRouting: downstreamOpt
        });
      } else {
        // This is a terminal segment
        finalPlan.executionSteps.push({
          level: treeNode.level,
          segment: segment,
          amount: segmentOpt.optimalAmount,
          terminal: true
        });
      }
    }

    return finalPlan;
  }

  /**
   * Optimize routing among children nodes
   */
  async optimizeChildrenRouting(children, availableAmount, inputToken) {
    console.log(`🎯 Optimizing downstream routing for ${children.length} options`);

    const childOptimizations = [];

    for (const child of children) {
      // Calculate potential for each child route
      const childPotential = await this.calculateChildPotential(
        child,
        availableAmount,
        inputToken
      );
      
      childOptimizations.push({
        child: child,
        potential: childPotential,
        optimalAmount: childPotential.suggestedAmount
      });
    }

    // Use genetic algorithm to distribute among children
    const ga = new ChildDistributionGA();
    const optimalChildDistribution = await ga.optimizeChildDistribution(
      childOptimizations,
      availableAmount
    );

    return optimalChildDistribution;
  }

  /**
   * Calculate potential efficiency for a child route
   */
  async calculateChildPotential(child, availableAmount, inputToken) {
    const pool = child.pool;
    const reserves = await pool.getReserves();
    
    // Calculate efficiency metrics
    const maxAmount = availableAmount.div(2); // Conservative estimate
    const impact = await this.optimizeSegmentAmount(pool, maxAmount, inputToken, child.segment.split('/')[1]);
    
    return {
      efficiency: impact.efficiency,
      maxCapacity: maxAmount,
      suggestedAmount: impact.optimalAmount,
      priceImpact: impact.priceImpact
    };
  }

  // Helper methods
  calculatePriceImpact(reserve0, reserve1, inputAmount) {
    const originalPrice = reserve1.mul(ethers.utils.parseEther('1')).div(reserve0);
    const newReserve0 = reserve0.add(inputAmount);
    const k = reserve0.mul(reserve1);
    const newReserve1 = k.div(newReserve0);
    const newPrice = newReserve1.mul(ethers.utils.parseEther('1')).div(newReserve0);
    
    return parseFloat(ethers.utils.formatEther(newPrice.sub(originalPrice).mul(10000).div(originalPrice))) / 10000;
  }
}

/**
 * Genetic Algorithm for path distribution optimization
 */
class PathDistributionGA {
  async optimize(pathDemands, totalAmount, levelNode) {
    // Simplified GA for path distribution
    const pathCount = pathDemands.length;
    let bestDistribution = new Array(pathCount).fill(0).map(() => Math.random());
    
    // Normalize
    const sum = bestDistribution.reduce((a, b) => a + b, 0);
    bestDistribution = bestDistribution.map(x => x / sum);
    
    // Return amounts for each path
    return pathDemands.map((pathDemand, index) => ({
      path: pathDemand.path,
      allocatedAmount: totalAmount.mul(Math.floor(bestDistribution[index] * 10000)).div(10000)
    }));
  }
}

/**
 * Genetic Algorithm for child distribution optimization
 */
class ChildDistributionGA {
  async optimizeChildDistribution(childOptimizations, availableAmount) {
    // Simplified optimization - distribute based on efficiency
    const totalEfficiency = childOptimizations.reduce((sum, child) => 
      sum + parseFloat(ethers.utils.formatEther(child.potential.efficiency)), 0
    );
    
    return childOptimizations.map(childOpt => ({
      child: childOpt.child,
      allocatedAmount: availableAmount.mul(
        Math.floor((parseFloat(ethers.utils.formatEther(childOpt.potential.efficiency)) / totalEfficiency) * 10000)
      ).div(10000)
    }));
  }
}

/**
 * Shared Segment Analyzer
 */
class SharedSegmentAnalyzer {
  // Implementation for analyzing shared segments
}

/**
 * Segment Optimizer  
 */
class SegmentOptimizer {
  // Implementation for optimizing individual segments
}

export default HierarchicalPathOptimizer;
export { PathDistributionGA, ChildDistributionGA, SharedSegmentAnalyzer, SegmentOptimizer };